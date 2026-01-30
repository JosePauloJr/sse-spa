require('dotenv').config();
const express = require('express');
const Redis = require('ioredis');
const cors = require('cors');

const app = express();
app.use(cors());

// 1. Conexão com Redis
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = new Redis(REDIS_URL);
const redisSubscriber = new Redis(REDIS_URL);

// Tratamento de erros globais do Redis
redisClient.on('error', (err) => console.error('❌ Redis Client Error:', err));
redisSubscriber.on('error', (err) => console.error('❌ Redis Subscriber Error:', err));

console.log(`🔌 Conectando ao Redis em: ${REDIS_URL}`);

app.get('/events', async (req, res) => {
    const { token, type } = req.query;

    // --- SEGURANÇA 🔒 ---
    // Agora validamos o token E o tipo (ex: chats, pipeline, conversa)
    if (!token || !type) {
        return res.status(401).json({ error: 'Token e Tipo (type) são obrigatórios' });
    }

    // A busca no Redis agora respeita o prefixo definido no n8n
    // Ex: token:chats:XYZ ou token:pipeline:XYZ
    const redisKey = `token:${type}:${token}`;
    const permissionChannel = await redisClient.get(redisKey);

    if (!permissionChannel) {
        console.warn(`⛔ Acesso negado. Tipo: ${type} | Token: ${token}`);
        return res.status(403).json({ error: 'Token inválido ou expirado para este fluxo' });
    }
    // --------------------

    console.log(`✅ Cliente autorizado! Fluxo: ${type} -> Canal: ${permissionChannel}`);

    // Configura Headers do SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Cria uma conexão Redis dedicada para este cliente
    const localSub = redisSubscriber.duplicate();
    
    try {
        await localSub.subscribe(permissionChannel);
    } catch (err) {
        console.error('❌ Erro ao assinar canal:', err);
        return res.end();
    }

    // Repassa mensagens do Redis para o Front
    localSub.on('message', (channel, message) => {
        res.write(`data: ${message}\n\n`);
    });

    // Heartbeat para evitar timeout (30s)
    const keepAlive = setInterval(() => {
        res.write(': keep-alive\n\n');
    }, 30000);

    // Limpeza ao desconectar
    req.on('close', () => {
        console.log(`❌ Cliente saiu do fluxo ${type} (Canal: ${permissionChannel})`);
        clearInterval(keepAlive);
        localSub.quit(); 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor SSE Multi-Fluxo rodando na porta ${PORT}`);
});
