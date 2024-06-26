"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const secuences_model_1 = require("./models/secuences.model");
const db_1 = require("./db");
const player_model_1 = __importDefault(require("./models/player.model"));
const webhook_model_1 = require("./models/webhook.model");
const { Player } = player_model_1.default;
const cors_1 = __importDefault(require("cors"));
const ws_1 = require("ws");
const MAX_CONNECTIONS = 7;
let connectedClients = 0;
const http = require('http');
const app = (0, express_1.default)();
const server = http.createServer(app);
const wss = new ws_1.WebSocketServer({ server });
const desiredPort = 3000;
(0, db_1.connectDB)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
let playerPendientes = [];
const allClients = [];
let connectedClientsMap = new Map();
const connectedUsers = [];
let generatedKeys = [];
let generatedScore;
// Short Polling 
app.get('/players', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const jugadores = yield player_model_1.default.Player.find({}, "name score");
    const jugador = jugadores.map(jugador => ({ name: jugador.name, score: jugador.score }));
    res.status(200).json({
        success: true,
        jugador
    });
}));
// BORRAR TODOS LOS USUARIOS
app.delete('/players', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield Player.deleteMany({});
        res.status(200).json({
            success: true,
            message: 'Todos los jugadores han sido eliminados.'
        });
    }
    catch (error) {
        console.error('Error al eliminar jugadores:', error);
        res.status(500).json({
            success: false,
            message: 'Se produjo un error al eliminar los jugadores.'
        });
    }
}));
// Long Polling
app.get('/allPlayers', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const jugadores = yield player_model_1.default.Player.find({}, "name");
    const jugador = jugadores.map(jugador => ({ name: jugador.name }));
    res.status(200).json({
        success: true,
        jugador
    });
}));
app.get("/nuevo-player", (req, res) => {
    playerPendientes.push(res);
});
// SSE
app.get("/all", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    allClients.push(res);
    req.on('close', () => {
        res.end();
    });
}));
//WEBHOOKS
app.post('/webhooks', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const url = req.body.webhook;
    try {
        if (!url) {
            return res.status(400).json({ success: false, message: 'Se requiere una URL para el webhook.' });
        }
        const newWebhook = new webhook_model_1.Webhook({ url });
        yield newWebhook.save(); // Guarda el nuevo webhook en la base de datos
        res.status(201).json({ success: true, webhook: newWebhook });
    }
    catch (error) {
        console.error('Error al crear el webhook:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
}));
// WebSockets
wss.on('connection', (ws) => {
    if (connectedClients >= MAX_CONNECTIONS) {
        ws.close(1000, 'Too many connections');
        return;
    }
    connectedClients++;
    // Variable local para almacenar el nombre de usuario conectado en esta sesión
    let playerName = '';
    ws.on('message', (data) => __awaiter(void 0, void 0, void 0, function* () {
        const parsedMessage = JSON.parse(data);
        if (parsedMessage.type === 'player') {
            playerName = parsedMessage.nickname;
            const playerPasswd = parsedMessage.passwd;
            const loginPlayerName = yield Player.findOne({ name: playerName }).exec();
            if (loginPlayerName) {
                if (loginPlayerName.passwd === playerPasswd) {
                    ws.send(JSON.stringify({ type: 'reconnect', message: 'Reconexion exitosa' }));
                    connectedClientsMap.set(playerName, { ws, playerId: loginPlayerName._id });
                    const connectedUser = {
                        id: loginPlayerName._id.toString(),
                        name: loginPlayerName.name
                    };
                    connectedUsers.push(connectedUser);
                    notifyAllClients("connectedPlayers", connectedUsers);
                    const mensajeReconexion = `Se reconecto ${playerName}`;
                    yield enviarNotificacionDiscord(mensajeReconexion);
                    updateAndSendScores();
                }
                else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Nombre de usuario o contraseña incorrecto' }));
                }
            }
            else {
                const newPlayer = new Player({
                    name: playerName,
                    passwd: playerPasswd
                });
                yield newPlayer.save();
                connectedClientsMap.set(playerName, { ws, playerId: newPlayer._id });
                const mensajeReconexion = `Se registro ${playerName}`;
                yield enviarNotificacionDiscord(mensajeReconexion);
                const connectedUser = {
                    id: newPlayer._id.toString(),
                    name: newPlayer.name
                };
                connectedUsers.push(connectedUser);
                ws.send(JSON.stringify({ type: 'register', message: 'Jugador registrado' }));
                notifyAllClients("connectedPlayers", connectedUsers);
                updateAndSendScores();
            }
        }
        switch (parsedMessage.action) {
            case "connectedPlayers":
                ws.send(JSON.stringify({
                    event: "connectedPlayers",
                    data: connectedUsers
                }));
                break;
            case "startGaming":
                const usuarioConectado = yield player_model_1.default.Player.findOne({ name: playerName });
                const userSession = connectedClientsMap.get(playerName);
                if (userSession) {
                    if (usuarioConectado) {
                        const nivelUsuario = usuarioConectado.level;
                        const { keys, score } = (0, secuences_model_1.generateLevelData)(nivelUsuario);
                        generatedKeys = keys;
                        generatedScore = score;
                        ws.send(JSON.stringify({
                            event: "startGaming",
                            data: generatedKeys
                        }));
                    }
                    else {
                        console.log("Usuario no encontrado en la base de datos");
                    }
                }
                break;
            case "checKeys":
                const pressedKeysString = JSON.stringify(parsedMessage.keys);
                const generatedKeysString = JSON.stringify(generatedKeys);
                const Session = connectedClientsMap.get(playerName);
                let updatedLives = 0;
                let updatedLevel = 0;
                let updatedScore = 0;
                if (pressedKeysString === generatedKeysString) {
                    if (Session) {
                        yield player_model_1.default.Player.updateOne({ _id: Session.playerId }, { $inc: { score: generatedScore, level: 1 } });
                        // Obtener el usuario actualizado
                        const updatedUser = yield player_model_1.default.Player.findById(Session.playerId);
                        updatedLives = updatedUser ? updatedUser.lives : 0;
                        updatedLevel = updatedUser ? updatedUser.level : 0;
                    }
                    else {
                        console.log('Las teclas coinciden pero el usuario no está registrado.');
                    }
                }
                else {
                    if (Session) {
                        // Reducir una vida del usuario
                        yield player_model_1.default.Player.updateOne({ _id: Session.playerId }, { $inc: { lives: -1 } });
                        const updatedUser = yield player_model_1.default.Player.findById(Session.playerId);
                        updatedLives = updatedUser ? updatedUser.lives : 0;
                        updatedLevel = updatedUser ? updatedUser.level : 0;
                        updatedScore = updatedUser ? updatedUser.score : 0;
                    }
                    else {
                        console.log('Las teclas no coinciden o el usuario no está registrado.');
                    }
                }
                const mensajeReconexion = `${playerName} con ${updatedLives} vidas`;
                yield enviarNotificacionDiscord(mensajeReconexion);
                ws.send(JSON.stringify({
                    event: "lives-",
                    data: { lives: updatedLives }
                }));
                updateAndSendScores();
                break;
            case "lives":
                const userLivesSession = connectedClientsMap.get(playerName);
                if (userLivesSession) {
                    const usuarioConectado = yield player_model_1.default.Player.findById(userLivesSession.playerId);
                    if (usuarioConectado) {
                        if (usuarioConectado.lives === 3) {
                            ws.send(JSON.stringify({
                                event: "lives",
                                data: { lives: usuarioConectado.lives }
                            }));
                        }
                    }
                    else {
                        console.log("Usuario no encontrado en la base de datos");
                    }
                }
                break;
        }
    }));
    ws.on('close', () => __awaiter(void 0, void 0, void 0, function* () {
        console.log("Cliente desconectado.");
        connectedClients--;
        const userSession = connectedClientsMap.get(playerName);
        if (userSession) {
            const disconnectedUserIndex = connectedUsers.findIndex(user => user.name === playerName);
            if (disconnectedUserIndex !== -1) {
                connectedUsers.splice(disconnectedUserIndex, 1);
                notifyAllClients("connectedPlayers", connectedUsers);
                const mensajeReconexion = `${playerName} se desconecto`;
                yield enviarNotificacionDiscord(mensajeReconexion);
            }
            else {
                console.log("Usuario no encontrado en la lista de usuarios conectados.");
            }
            connectedClientsMap.delete(playerName);
        }
        else {
            console.log("Sesión de usuario no encontrada.");
        }
    }));
});
const notifyAllClients = (event, data) => {
    wss.clients.forEach(client => {
        if (client.readyState === ws_1.WebSocket.OPEN) {
            client.send(JSON.stringify({ event, data }));
            console.log("Clientes conectados", connectedClients);
        }
    });
};
const updateAndSendScores = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const jugador = yield player_model_1.default.Player.find({}, "name score level");
        const infoPlayer = `event: infoPlayer\n` + `data: ${JSON.stringify(jugador)}\n\n`;
        for (let client of allClients) {
            client.write(infoPlayer);
        }
    }
    catch (error) {
        console.error("Error al actualizar y enviar los datos de los jugadores:", error);
    }
});
const enviarNotificacionDiscord = (mensaje) => __awaiter(void 0, void 0, void 0, function* () {
    const webhooks = yield webhook_model_1.Webhook.find();
    for (const webhook of webhooks) {
        yield axios_1.default.post(webhook.url, {
            content: mensaje
        });
    }
});
server.listen(desiredPort, () => {
    console.log(`Server running in port:  ${desiredPort}`);
});
