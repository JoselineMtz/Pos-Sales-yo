// server.js

import express from "express";
import jwt from "jsonwebtoken";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

// 👇 IMPORTAMOS LOS ROUTERS EXTERNOS
import createStockRouter from './rutes/stockRoutes.js';
import createSalesRouter from './rutes/sales.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
// ¡CAMBIO IMPORTANTE! Usa la llave de servicio.
const supabaseKey = process.env.SUPABASE_SERVICE_KEY; 

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('✅ Cliente Supabase inicializado con permisos de servicio');

// ===================== MIDDLEWARE JWT =====================
function verifyToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Token no proporcionado o con formato incorrecto" });
    }
    const token = authHeader.split(" ")[1];
    try {
        const user = jwt.verify(token, process.env.JWT_SECRET || "clave_secreta");
        req.user = user;
        next();
    } catch (err) {
        return res.status(403).json({ message: "Token inválido o expirado" });
    }
}

// ===================== ENRUTADOR PRINCIPAL DE LA API =====================
const apiRouter = express.Router();

// Ruta de Health Check
apiRouter.get("/health", async (req, res) => {
    const { error } = await supabase.from('usuarios').select('id').limit(1);
    res.json({
        message: "Servidor funcionando correctamente",
        database: error ? "Error" : "Conectado",
        timestamp: new Date().toISOString(),
    });
});

// ===================== RUTAS DE PERMISOS =====================
apiRouter.get("/permissions/:employeeId", verifyToken, async (req, res) => {
    if (req.user.rol !== "admin") {
        return res.status(403).json({ message: "Solo los administradores pueden ver permisos" });
    }
    const { employeeId } = req.params;
    try {
        const { data, error } = await supabase
            .from('user_permissions')
            .select('permissions')
            .eq('user_id', employeeId)
            .single();

        if (error && error.code !== 'PGRST116') throw error; // Ignora el error "no encontrado"

        if (!data) {
            const defaultPermissions = { can_view_products: true, can_edit_products: false, can_delete_products: false, can_create_products: false, can_view_sales: true, can_create_sales: true, can_view_customers: true, can_edit_customers: false, can_view_reports: false, can_manage_stock: false };
            return res.json({ permissions: defaultPermissions });
        }
        res.json({ permissions: data.permissions });
    } catch (error) {
        console.error("Error al obtener permisos:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

apiRouter.post("/permissions", verifyToken, async (req, res) => {
    if (req.user.rol !== "admin") {
        return res.status(403).json({ message: "Solo los administradores pueden modificar permisos" });
    }
    const { employee_id, permissions } = req.body;
    if (!employee_id || !permissions) {
        return res.status(400).json({ message: "Datos incompletos" });
    }
    try {
        const { error } = await supabase
            .from('user_permissions')
            .upsert({ user_id: employee_id, permissions: permissions });
            
        if (error) throw error;
        res.json({ message: "Permisos guardados correctamente" });
    } catch (error) {
        console.error("Error al guardar permisos:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// ===================== RUTAS DE CLIENTES =====================
apiRouter.get("/clientes", verifyToken, async (req, res) => {
    try {
        const { data, error } = await supabase.from('clientes').select('*').order('nombre');
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener clientes" });
    }
});

apiRouter.get("/clientes/con-deuda", verifyToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('clientes')
            .select('id, nombre, rut, telefono, saldo_pendiente')
            .gt('saldo_pendiente', 0)
            .order('nombre', { ascending: true });
            
        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error("❌ ERROR al obtener clientes con deuda:", error);
        res.status(500).json({ error: "No se puede mostrar clientes con deuda" });
    }
});

apiRouter.post("/clientes", verifyToken, async (req, res) => {
    const { rut, nombre, telefono, email, direccion } = req.body;
    if (!nombre || !telefono) {
        return res.status(400).json({ message: "Nombre y teléfono son obligatorios" });
    }
    try {
        const { data, error } = await supabase
            .from('clientes')
            .insert({ rut: rut?.trim(), nombre, telefono, email, direccion, saldo_pendiente: 0 })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ ...data, message: "Cliente creado exitosamente" });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: "El RUT ya está registrado" });
        }
        res.status(500).json({ error: "Error al crear cliente" });
    }
});

// ===================== RUTAS DE USUARIOS =====================
apiRouter.get("/usuarios", verifyToken, async (req, res) => {
    if (req.user.rol !== "admin") {
        return res.status(403).json({ message: "Acceso denegado" });
    }
    try {
        const { data, error } = await supabase.from('usuarios').select('id, username, nombre, rol');
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

apiRouter.post("/usuarios", verifyToken, async (req, res) => {
    if (req.user.rol !== "admin") {
        return res.status(403).json({ message: "Acceso denegado" });
    }
    const { username, nombre, password, rol } = req.body;
    if (!username || !nombre || !password || !rol) {
        return res.status(400).json({ message: "Faltan datos" });
    }
    try {
        const { data, error } = await supabase
            .from('usuarios')
            .insert({ username, nombre, password, rol })
            .select('id, username, nombre, rol')
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// ===================== RUTA DE LOGIN =====================
apiRouter.post("/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: "Faltan datos" });
    }
    try {
        const { data: users, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('username', username)
            .eq('password', password);

        if (error) throw error;
        if (users.length === 0) {
            return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
        }

        const user = users[0];
        const token = jwt.sign(
            { id: user.id, username: user.username, rol: user.rol, nombre: user.nombre },
            process.env.JWT_SECRET || "clave_secreta",
            { expiresIn: "8h" }
        );

        res.json({
            message: "Login exitoso",
            token,
            user: { id: user.id, username: user.username, rol: user.rol, nombre: user.nombre }
        });
    } catch (error) {
        res.status(500).json({ message: "Error en la base de datos" });
    }
});

// ===================== CONFIGURACIÓN DE ROUTERS EXTERNOS =====================
console.log("🔍 Configurando routers externos...");
// Pasamos la conexión de Supabase a cada función creadora de routers
const stockRouter = createStockRouter(supabase);
const salesRouter = createSalesRouter(supabase);

// Montamos los routers importados en sus rutas base, protegidas por el token
apiRouter.use("/stock", verifyToken, stockRouter);
apiRouter.use("/sales", verifyToken, salesRouter);

// ===================== MONTAJE FINAL Y ARRANQUE =====================
// Montamos el router principal de la API en la ruta /api
app.use("/api", apiRouter);

// Middleware para manejar rutas no encontradas (404)
app.use((req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
});

// Iniciar el servidor
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor en ejecución en el puerto ${PORT}`);
});

export default app;