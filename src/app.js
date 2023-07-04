import express, { json } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import Joi from "joi";
import dayjs from "dayjs";
import { stripHtml } from 'string-strip-html';

const app = express();

app.use(cors());
app.use(json());
dotenv.config();

const mongoClient = new MongoClient(process.env.DATABASE_URL);

//Schemas 
const schemaName = Joi.string().required();
const schemaMessage = Joi.object({
    from: Joi.string().required(),
    to: Joi.string().required(),
    text: Joi.string().required(),
    type: Joi.valid('message', 'private_message').required()
});

try {
    await mongoClient.connect();
    console.log("MongoDB conectado!");
} catch (err){
    (err) => console.log(err.message);
}

const db = mongoClient.db();

setInterval(async ()=>{
    try {
        const timeStamp = Date.now() - 10000;
        const removidos = await db.collection("participants").find({lastStatus: {$lt: timeStamp}}).toArray();
        await db.collection("participants").deleteMany({lastStatus: {$lt: timeStamp}});
        console.log(removidos);
        if (removidos.length > 0){
            const mensagens = removidos.map(usuario => {
                return ({
                    from: usuario.name,
                    to: "Todos",
                    text: "sai da sala...",
                    type: "status",
                    time: dayjs().format('HH:mm:ss')
                });
            });
            await db.collection("messages").insertMany(mensagens);
        }
    } catch (err) {
        console.log(err);
    }
}, 15000)

app.post("/participants", async (req, res) => {
    let { name } = req.body;
    const validation = schemaName.validate(name, {abortEarly: false});
    try {
        if (name && !validation.error){
            name = stripHtml(name).result.trim();
            const participante = await db.collection("participants").findOne({name});
            if (participante) return res.sendStatus(409);
            const timeStamp = Date.now();
            await db.collection("participants").insertOne({
                name,
                lastStatus: timeStamp
            });
            await db.collection("messages").insertOne({
                from: name,
                to: 'Todos',
                text: 'entra na sala...',
                type: 'status',
                time: dayjs(timeStamp).format('HH:mm:ss')
            });
            return res.sendStatus(201);
        } else{
            return res.sendStatus(422);
        }
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
    const validation = schemaMessage.validate({...req.body, from}, {abortEarly: false});
    try {
        if (!validation.error) {
            const participante = await db.collection("participants").findOne({name: stripHtml(from).result.trim()});
            if (!participante) return res.sendStatus(422);
            await db.collection("messages").insertOne({
                from: stripHtml(from).result.trim(),
                to: stripHtml(to).result.trim(),
                text: stripHtml(text).result.trim(),
                type: stripHtml(type).result.trim(),
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
    if (limit && (limit <=0 || isNaN(limit))){
        return res.sendStatus(422);
    }
    try {
        const mensagens = await db.collection('messages').find({
            $or: [
                {type: 'message'},
                {type: 'status'},
                {to: 'Todos'},
                {to: user},
                {from: user}
            ]
        }).sort({$natural: -1}).limit(!limit ? 0 : Number(limit)).toArray();
        res.send(mensagens.reverse());
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
    const validation = schemaMessage.validate({...req.body, from}, {abortEarly: false});
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

app.listen(process.env.PORT, () => console.log(`Servidor está rodando na porta ${process.env.PORT}`));