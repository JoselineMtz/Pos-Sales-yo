// userRoutes.js
import express from 'express';
import { db } from './server.js'; // Importa la conexión a la BD

const router = express.Router();

router.get("/", (req, res) => {
    db.query("SELECT id, username, nombre, rol FROM usuarios", (err, results) => {
        if (err) return res.status(500).json({ error: "Error interno del servidor" });
        res.json(results);
    });
});

router.post("/", (req, res) => {
    const { username, nombre, password, role } = req.body;
    if (!username || !nombre || !password || !rol) return res.status(400).json({ message: "Faltan datos" });

    db.query(
        "INSERT INTO usuarios (username, nombre, password, rol) VALUES (?, ?, ?, ?)",
        [username, nombre, password, rol],
        (err, result) => {
            if (err) return res.status(500).json({ error: "Error interno del servidor" });
            res.json({ id: result.insertId, username, nombre, rol });
        }
    );
});

export default router;