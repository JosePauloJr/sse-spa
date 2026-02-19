require('dotenv').config();
const express = require('express');
const Redis = require('ioredis');
const cors = require('cors');

const app = express();
app.use(cors()); // Libera acesso para seu frontend

// 1. Conexão com Redis
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = new Redis(REDIS_URL); // Para consultar tokens
const redisSubscriber = new Redis(REDIS_URL); // Para escutar canais

// Tratamento de erros globais do Redis (evita que o servidor caia se o Redis oscilar)
redisClient.on('error', (err) => console.error('❌ Redis Client Error:', err));
redisSubscriber.on('error', (err) => console.error('❌ Redis Subscriber Error:', err));

console.log(`🔌 Conectando ao Redis em: ${REDIS_URL}`);

app.get('/events', async (req, res) => {
    const { token, type } = req.query;

    // --- SEGURANÇA 🔒 ---
    // Valida se Token e Tipo foram enviados
    if (!token || !type) {
        return res.status(401).json({ error: 'Token e Tipo (type) são obrigatórios' });
    }

    // Busca no Redis respeitando o padrão: token:chats:XYZ ou token:pipeline:XYZ
    const redisKey = `token:${type}:${token}`;
    const permissionChannel = await redisClient.get(redisKey);

    if (!permissionChannel) {
        console.warn(`⛔ Acesso negado. Tipo: ${type} | Token: ${token}`);
        return res.status(403).json({ error: 'Token inválido ou expirado para este fluxo' });
    }
    // --------------------

    console.log(`✅ Cliente autorizado! Fluxo: ${type} -> Canal: ${permissionChannel}`);

    // --- CONFIGURAÇÃO SSE (COM FIX DE ENCODING) ---
    // Adicionado '; charset=utf-8' para suportar Emojis e Acentos
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Cria uma conexão Redis dedicada para este cliente (Subscriber isolado)
    const localSub = redisSubscriber.duplicate();
    
    try {
        await localSub.subscribe(permissionChannel);
    } catch (err) {
        console.error('❌ Erro ao assinar canal:', err);
        return res.end();
    }

    // Repassa mensagens do Redis para o Front
    localSub.on('message', (channel, message) => {
        // Envia o dado mantendo a formatação original
        res.write(`data: ${message}\n\n`);
    });

    // Envia um "Heartbeat" a cada 30s para manter a conexão viva
    const keepAlive = setInterval(() => {
        res.write(': keep-alive\n\n');
    }, 30000);

    // Limpeza quando o cliente fecha a aba ou perde conexão
    req.on('close', () => {
        console.log(`❌ Cliente saiu do fluxo ${type} (Canal: ${permissionChannel})`);
        clearInterval(keepAlive);
        localSub.quit(); // Fecha a conexão Redis desse cliente específico
    });
});

const PORT = process.env.PORT || 3007;
app.listen(PORT, () => {
    console.log(`🚀 Servidor SSE Multi-Fluxo (UTF-8) rodando na porta ${PORT}`);
});

