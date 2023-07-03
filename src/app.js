import express, { json } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import Joi from "joi";
import dayjs from "dayjs";

const app = express()

app.use(cors());
app.use(json());
dotenv.config();

const mongoClient = new MongoClient(process.env.DATABASE_URL);

try {
    await mongoClient.connect();
    console.log("MongoDB conectado!");
} catch (err){
    (err) => console.log(err.message);
}

const db = mongoClient.db();

setInterval(async ()=>{
    try {
        const removidos = await db.collection("participants").find({lastStatus: {$lt: Date.now()-10000}}).toArray();
        await db.collection("participants").deleteMany({lastStatus: {$lt: Date.now()-10000}});
        console.log(removidos);
        removidos.forEach(async usuario => {
            await db.collection("messages").insertOne({
                from: usuario.name,
                to: "Todos",
                text: "sai da sala...",
                type: "status",
                time: dayjs().format('HH:mm:ss')
            })
        });
    } catch (err) {
        res.status(500).send(err.message);
    }
}, 15000)

app.post("/participants", async (req, res) => {
    const { name } = req.body;
    const schemaName = Joi.string().required();
    const validation = schemaName.validate(name);
    if (validation.error){
        return res.sendStatus(422);
    }
    try {
        const participante = await db.collection("participants").findOne({name});
        if (participante) return res.sendStatus(409);
        await db.collection("participants").insertOne({
            name,
            lastStatus: Date.now()
        });
        await db.collection("messages").insertOne({
            from: name,
            to: 'Todos',
            text: 'entra na sala...',
            type: 'status',
            time: dayjs().format('HH:mm:ss')
        });
        res.sendStatus(201);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get('/participants', async (req, res) => {
   try {
    const participantes = await db.collection("participants").find().toArray();
    res.send(participantes);
   } catch (err) {
    res.status(500).send(err.message);
   }

}); 

app.post('/messages', async (req, res) => {
    const { to, text, type } = req.body;
    const from = req.headers.user;
    const schemaMessage = Joi.object({
        to: Joi.string().required(),
        text: Joi.string().required(),
        type: Joi.any().valid('message', 'private_message')
    })
    const validation = schemaMessage.validate(req.body);
    try {
        if (from && !validation.error) {
            const participante = await db.collection("participants").findOne({name: from});
            if (!participante) return res.sendStatus(422);
            res.send(participante);
            await db.collection("messages").insertOne({
                from,
                to,
                text,
                type,
                time: dayjs().format('HH:mm:ss')
            });
            res.sendStatus(201);
        } else{ 
            return res.sendStatus(422);
        }
    } catch (err) {
        console.log(err.message);
    }
});

app.get('/messages', async (req, res) => {
    const { user } = req.headers;
    let { limit } = req.query;
    try {
        const mensagens = await db.collection('messages').find({
            $or: [
                {type: 'message'},
                {type: 'status'},
                {to: 'Todos'},
                {to: user},
                {from: user}
            ]
        }).toArray();
        if (limit && (limit <=0 || isNaN(limit) )){
            return res.sendStatus(422);
        }else if (limit) {
            const filtada = [];
            let i = 1;
            while (limit > 0){
                if (!mensagens[mensagens.length-i]){
                    break;
                }
                filtada.push(mensagens[mensagens.length-i]);
                i++;
                limit--;
            }
            return res.send(filtada.reverse());
        }
        res.send(mensagens);
    } catch (err){
        res.status(500).send(err.message);
    }
});

app.post('/status', async (req, res) => {
    const { user } = req.headers;
    if (!user) return res.sendStatus(404);
    const result = await db.collection("participants").updateOne(
        {name: user},
        {$set: {lastStatus: Date.now()}}
    )
    if (result.matchedCount === 0) return res.sendStatus(404);
    res.sendStatus(200);
});

app.delete("/messages/:id", async (req, res) => {
    const { user } = req.headers;
    const { id } = req.params;
    try {
        const dono = await db.collection("messages").findOne({_id: new ObjectId(id)});
        if (!dono) return res.sendStatus(404);
        if (dono.from != user) return res.sendStatus(401);
        const result = await db.collection("messages").deleteOne({_id: new ObjectId(id)});
        if (result.deletedCount === 0) return res.sendStatus(404);
        res.sendStatus(200);
    } catch (err) {
        res.sendStatus(500);
    }
});

app.put("/messages/:id", async (req,res) => {
    const from = req.headers.user;
    const { id } = req.params;

    const schemaEdit = Joi.object({
        to: Joi.string().required(),
        text: Joi.string().required(),
        type: Joi.any().valid('message', 'private_message')
    });
    const validation = schemaEdit.validate(req.body);
    if (validation.error) return res.sendStatus(422);
    try {
        const participa = await db.collection("participants").findOne({name: from});
        if (!participa) return res.sendStatus(422);
        const existe = await db.collection("messages").findOne({_id: new ObjectId(id)});
        if (!existe) return res.sendStatus(404);
        if (existe.from != from) return res.sendStatus(401);
        await db.collection("messages").updateOne(
            {_id: new ObjectId(id)},
            {$set: req.body}
        );
        res.sendStatus(200);

    } catch (err) {
        res.sendStatus(500);
    }
})


const PORT = 5000; 
app.listen(PORT, () => console.log(`Servidor está rodando na porta ${PORT}`));