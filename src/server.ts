import express, { Request, Response } from 'express';
import axios from 'axios';
import { ConnectedUser } from './models/Interfaces'; 
import { generateLevelData } from './models/secuences.model';
import { connectDB } from './db';
import mongoose from 'mongoose';
import schemas from './models/player.model';
import { Webhook } from './models/webhook.model'; 
const { Player } = schemas;

import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
const MAX_CONNECTIONS = 7;
let connectedClients = 0;

const http = require('http');
const app = express();

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const desiredPort = 3000;

connectDB();

app.use(cors());
app.use(express.json());

let playerPendientes: Array<Response> = [];

const allClients: Response[] = [];

let connectedClientsMap = new Map<string, { ws: WebSocket, playerId: mongoose.Types.ObjectId }>();
const connectedUsers: ConnectedUser[] = [];


let generatedKeys: string[] = [];
let generatedScore: number;

// Short Polling 
app.get('/players', async (req: Request, res: Response) => {
  const jugadores = await schemas.Player.find({}, "name score");
  const jugador = jugadores.map(jugador => ({ name: jugador.name, score: jugador.score }));
  res.status(200).json({
    success: true,
    jugador
  });
});

// BORRAR TODOS LOS USUARIOS
app.delete('/players', async (req: Request, res: Response) => {
  try {
    await Player.deleteMany({});
    res.status(200).json({
      success: true,
      message: 'Todos los jugadores han sido eliminados.'
    });
  } catch (error) {
    console.error('Error al eliminar jugadores:', error);
    res.status(500).json({
      success: false,
      message: 'Se produjo un error al eliminar los jugadores.'
    });
  }
});

// Long Polling
app.get('/allPlayers', async (req: Request, res: Response) => {
  const jugadores = await schemas.Player.find({}, "name");
  const jugador = jugadores.map(jugador => ({ name: jugador.name }));
  res.status(200).json({
    success: true,
    jugador
  });
});

app.get("/nuevo-player", (req: Request, res: Response) => {
  playerPendientes.push(res);
});


// SSE
app.get("/all", async(req: Request, res:Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  allClients.push(res);

  req.on('close', () => {
      res.end();
  });

})


//WEBHOOKS
app.post('/webhooks', async (req: Request, res: Response) => {
  const url  = req.body.webhook;
  try {
    if (!url) {
      return res.status(400).json({ success: false, message: 'Se requiere una URL para el webhook.' });
    }

    const newWebhook = new Webhook({ url });
    await newWebhook.save(); // Guarda el nuevo webhook en la base de datos

    res.status(201).json({ success: true, webhook: newWebhook });
  } catch (error) {
    console.error('Error al crear el webhook:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
});

// WebSockets
wss.on('connection', (ws: WebSocket) => {
  if (connectedClients >= MAX_CONNECTIONS) {
    ws.close(1000, 'Too many connections');
    return;
  }
  connectedClients++;

  // Variable local para almacenar el nombre de usuario conectado en esta sesión
  let playerName = '';

  ws.on('message', async (data: string) => {
    const parsedMessage = JSON.parse(data);
    if (parsedMessage.type === 'player') {
      playerName = parsedMessage.nickname;
      const playerPasswd = parsedMessage.passwd
      const loginPlayerName = await Player.findOne({ name: playerName }).exec();

      if (loginPlayerName) {
        if (loginPlayerName.passwd === playerPasswd) {
          ws.send(JSON.stringify({ type: 'reconnect', message: 'Reconexion exitosa' }));

          connectedClientsMap.set(playerName, { ws, playerId: loginPlayerName._id });

          const connectedUser = {
            id: loginPlayerName._id.toString(),
            name: loginPlayerName.name
          };
          connectedUsers.push(connectedUser)


          notifyAllClients("connectedPlayers", connectedUsers);

          const mensajeReconexion = `Se reconecto ${playerName}`;
          await enviarNotificacionDiscord(mensajeReconexion);

          updateAndSendScores();
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Nombre de usuario o contraseña incorrecto' }));
        }
      } else {
        const newPlayer = new Player({
          name: playerName,
          passwd: playerPasswd
        });
        await newPlayer.save();
        connectedClientsMap.set(playerName, { ws, playerId: newPlayer._id });

        const mensajeReconexion = `Se registro ${playerName}`;
        await enviarNotificacionDiscord(mensajeReconexion);

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
        const usuarioConectado = await schemas.Player.findOne({ name: playerName });
        const userSession = connectedClientsMap.get(playerName);
        if (userSession) {
          if (usuarioConectado) {
            const nivelUsuario = usuarioConectado.level;

            const { keys, score } = generateLevelData(nivelUsuario);
            generatedKeys = keys;
            generatedScore = score;

            ws.send(JSON.stringify({
              event: "startGaming",
              data: generatedKeys
            }));
          } else {
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
              await schemas.Player.updateOne(
                { _id: Session.playerId },
                { $inc: { score: generatedScore, level: 1 } }
              );
        
                // Obtener el usuario actualizado
              const updatedUser = await schemas.Player.findById(Session.playerId);
              updatedLives = updatedUser ? updatedUser.lives : 0;
              updatedLevel = updatedUser ? updatedUser.level : 0;
            } else {
              console.log('Las teclas coinciden pero el usuario no está registrado.');
            }
          } else {
            if (Session) {
              // Reducir una vida del usuario
              await schemas.Player.updateOne(
                { _id: Session.playerId },
                { $inc: { lives: -1} }
              );
              const updatedUser = await schemas.Player.findById(Session.playerId);
              updatedLives = updatedUser ? updatedUser.lives : 0;
              updatedLevel = updatedUser ? updatedUser.level : 0;
              updatedScore = updatedUser ? updatedUser.score : 0;
            } else {
              console.log('Las teclas no coinciden o el usuario no está registrado.');
            }
            
          }
          const mensajeReconexion = `${playerName} con ${updatedLives} vidas`;
          await enviarNotificacionDiscord(mensajeReconexion);
          ws.send(JSON.stringify({
            event: "lives-",
            data: { lives: updatedLives }
          }));          
          updateAndSendScores();
          break;

      case "lives":
        const userLivesSession = connectedClientsMap.get(playerName);
        if (userLivesSession) {
          const usuarioConectado = await schemas.Player.findById(userLivesSession.playerId);
          if (usuarioConectado) {
            if (usuarioConectado.lives === 3) {
              ws.send(JSON.stringify({
                event: "lives",
                data: { lives: usuarioConectado.lives }
              }));
            }

            
          } else {
            console.log("Usuario no encontrado en la base de datos");
          }
        }
        break;
    }

  });

  ws.on('close', async () => {
    console.log("Cliente desconectado.");
    connectedClients--;
    const userSession = connectedClientsMap.get(playerName);
    if (userSession) {
      const disconnectedUserIndex = connectedUsers.findIndex(user => user.name === playerName);
      if (disconnectedUserIndex !== -1) {
        connectedUsers.splice(disconnectedUserIndex, 1);
        notifyAllClients("connectedPlayers", connectedUsers);

        const mensajeReconexion = `${playerName} se desconecto`;
        await enviarNotificacionDiscord(mensajeReconexion);

      } else {
        console.log("Usuario no encontrado en la lista de usuarios conectados.");
      }
      connectedClientsMap.delete(playerName);
    } else {
      console.log("Sesión de usuario no encontrada.");
    }
  });

});

const notifyAllClients = (event: string, data: any) => {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ event, data }));
      console.log("Clientes conectados", connectedClients)
    }
  });
};

const updateAndSendScores = async () => {
  try {
      const jugador = await schemas.Player.find({}, "name score level");
      const infoPlayer = `event: infoPlayer\n` + `data: ${JSON.stringify(jugador)}\n\n`;
      for (let client of allClients) {
          client.write(infoPlayer);
      }
  } catch (error) {
      console.error("Error al actualizar y enviar los datos de los jugadores:", error);
  }
};
const enviarNotificacionDiscord = async (mensaje:String) => {
  const webhooks = await Webhook.find();
  for (const webhook of webhooks) {
    await axios.post(webhook.url, {
      content: mensaje
    });
  }
};

server.listen(desiredPort, () => {
  console.log(`Server running in port:  ${desiredPort}`);
});