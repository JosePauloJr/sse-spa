require('dotenv').config(); // Permite usar arquivo .env localmente
const express = require('express');
const Redis = require('ioredis');
const cors = require('cors');

const app = express();
app.use(cors()); // Libera acesso para seu frontend

// 1. Conexão com Redis (Uma para comandos gerais, outra para Subscribe)
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = new Redis(REDIS_URL); // Usado para checar tokens
const redisSubscriber = new Redis(REDIS_URL); // Usado apenas para escutar canais

console.log(`🔌 Conectando ao Redis em: ${REDIS_URL}`);

app.get('/events', async (req, res) => {
    const token = req.query.token;

    // --- SEGURANÇA 🔒 ---
    if (!token) {
        return res.status(401).json({ error: 'Token obrigatório' });
    }

    // Consulta no Redis: "Esse token vale para qual canal?"
    // O n8n deve ter salvo algo como: SET token:abc1234 "chat_99" EX 60
    const permissionChannel = await redisClient.get(`token:${token}`);

    if (!permissionChannel) {
        console.warn(`⛔ Tentativa de acesso negada. Token: ${token}`);
        return res.status(403).json({ error: 'Token inválido ou expirado' });
    }
    // --------------------

    console.log(`✅ Cliente autorizado! Token: ${token} -> Canal: ${permissionChannel}`);

    // Configura Headers do SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Cria uma conexão Redis dedicada para este cliente (Subscriber isolado)
    const localSub = redisSubscriber.duplicate();
    
    // Assina o canal que o Token permitiu
    await localSub.subscribe(permissionChannel);

    // Repassa mensagens do Redis para o Front
    localSub.on('message', (channel, message) => {
        // Envia apenas o dado limpo
        res.write(`data: ${message}\n\n`);
    });

    // Envia um "Heartbeat" a cada 30s para evitar timeout de load balancers
    const keepAlive = setInterval(() => {
        res.write(': keep-alive\n\n');
    }, 30000);

    // Limpeza quando o cliente desconecta
    req.on('close', () => {
        console.log(`❌ Cliente desconectou do canal: ${permissionChannel}`);
        clearInterval(keepAlive);
        localSub.quit(); // Fecha a conexão Redis desse cliente
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor SSE Seguro rodando na porta ${PORT}`);
});