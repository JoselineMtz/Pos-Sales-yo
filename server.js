import express from "express";
import jwt from "jsonwebtoken";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import createStockRouter from "./stockRoutes.js";
import createSalesRouter from "./sales.js"; 

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ===================== CONEXIÓN Y DIAGNÓSTICO SUPABASE =====================
let supabase = null;
let databaseStatus = 'Inicializando...';
let databaseDetails = '';

const initializeSupabase = async () => {
    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_ANON_KEY;
        
        // El import dinámico se reemplaza por el import estático superior
        if (!createClient) throw new Error("Dependencia @supabase/supabase-js no cargada.");
        
        console.log('=== DIAGNÓSTICO SUPABASE ===');
        console.log('URL:', supabaseUrl ? '✅ Presente' : '❌ Faltante');
        console.log('Key:', supabaseKey ? '✅ Presente' : '❌ Faltante');

        if (!supabaseUrl || !supabaseKey) {
            databaseStatus = '❌ Variables faltantes';
            databaseDetails = 'Configura SUPABASE_URL y SUPABASE_ANON_KEY en Render';
            return;
        }

        // Crear cliente
        supabase = createClient(supabaseUrl, supabaseKey);
        console.log('✅ Cliente Supabase creado');

        // Prueba de Conexión y Diagnóstico (Usando tabla 'usuarios')
        console.log('🔍 Probando conexión a Supabase...');
        const { count, error: countError } = await supabase
            .from('usuarios')
            .select('*', { count: 'exact', head: true });

        if (countError) {
            if (countError.code === '42P01') {
                databaseStatus = '❌ Tabla no existe';
                databaseDetails = 'La tabla "usuarios" no existe en Supabase';
            } else if (countError.code === '42501') {
                databaseStatus = '❌ Error de permisos RLS';
                databaseDetails = 'Problema con Row Level Security. Revisa las políticas.';
            } else {
                databaseStatus = `❌ Error: ${countError.code}`;
                databaseDetails = countError.message;
            }
            console.error('❌ Error de Supabase:', countError);
        } else {
            databaseStatus = '✅ Conectado a PostgreSQL';
            databaseDetails = `Tabla usuarios encontrada. Registros: ${count || 0}`;
            console.log(`✅ Tabla usuarios tiene ${count} registros`);
        }

    } catch (error) {
        databaseStatus = `❌ Error crítico`;
        databaseDetails = error.message;
        console.error('❌ Error inicializando Supabase:', error);
    }
};

initializeSupabase();

// Stock router (pasa supabase en lugar de db)
const stockRouter = createStockRouter(supabase, verificarToken);

// Montar las rutas
apiRouter.use("/stock", stockRouter);


// Función helper que simula 'db.query' pero retorna el cliente Supabase
const db = {
    supabaseClient: () => supabase,
};

// ===================== MIDDLEWARE JWT =====================
function verificarToken(req, res, next) {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Token no proporcionado o formato inválido" });
    }

    const token = authHeader.split(" ")[1];

    jwt.verify(token, process.env.JWT_SECRET || "clave_secreta", (err, user) => {
        if (err) {
            console.log("❌ ERROR al verificar token:", err.message);
            return res.status(403).json({ message: "Token inválido o expirado" });
        }
        req.user = user;
        next();
    });
}

// ===================== ENRUTADOR PRINCIPAL DE LA API =====================
const apiRouter = express.Router();

// --- RUTAS DE DIAGNÓSTICO ---
apiRouter.get("/", (req, res) => {
    res.json({ 
        message: '✅ API POS funcionando',
        database: {
            status: databaseStatus,
            details: databaseDetails,
            timestamp: new Date().toISOString()
        }
    });
});

apiRouter.get("/health", (req, res) => {
    res.json({ 
        status: 'OK',
        database: {
            status: databaseStatus,
            details: databaseDetails
        },
        timestamp: new Date().toISOString()
    });
});

apiRouter.get('/config', (req, res) => {
    res.json({
        supabase: {
            url: process.env.SUPABASE_URL ? '✅ Configurada' : '❌ No configurada',
            key: process.env.SUPABASE_ANON_KEY ? '✅ Configurada' : '❌ No configurada',
            status: databaseStatus,
            details: databaseDetails
        },
        jwt: process.env.JWT_SECRET ? '✅ Configurada' : '❌ No configurada',
        timestamp: new Date().toISOString()
    });
});

// ===================== RUTA DE LOGIN (CON SUPABASE Y SIMULACIÓN) =====================
apiRouter.post("/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: "Usuario y contraseña requeridos", database_status: databaseStatus });
    }

    // 1. MODO SIMULACIÓN
    if (!supabase || !databaseStatus.includes('✅')) {
        const validUsers = {
            'admin': { id: 1, nombre: 'Admin Simulado', rol: 'admin' },
            'vendedor': { id: 2, nombre: 'Vendedor Simulado', rol: 'vendedor' }
        };

        if (validUsers[username] && password === '123456') {
            const user = validUsers[username];
            const token = jwt.sign(
                { id: user.id, username: username, rol: user.rol },
                process.env.JWT_SECRET || "clave_secreta",
                { expiresIn: "8h" }
            );
            
            return res.json({
                message: `Login exitoso (Modo simulación - ${databaseStatus})`,
                token,
                user: { id: user.id, username: username, nombre: user.nombre, rol: user.rol },
                database_status: databaseStatus
            });
        }
        
        return res.status(401).json({ message: "Credenciales incorrectas", database_status: databaseStatus });
    }

    // 2. LOGIN CON SUPABASE
    try {
        const { data: usuarios, error } = await supabase
            .from('usuarios')
            .select('id, username, nombre, rol')
            .eq('username', username)
            .eq('password', password); // NOTA: Considera usar HASHING en password

        if (error) {
            console.error('❌ Error de Supabase:', error);
            return res.status(500).json({ message: "Error en la base de datos", error: error.message, database_status: databaseStatus });
        }

        if (!usuarios || usuarios.length === 0) {
            return res.status(401).json({ message: "Usuario o contraseña incorrectos en la base de datos real", database_status: databaseStatus });
        }

        const user = usuarios[0];
        const token = jwt.sign(
            { id: user.id, username: user.username, rol: user.rol },
            process.env.JWT_SECRET || "clave_secreta",
            { expiresIn: "8h" }
        );

        res.json({
            message: "Login exitoso (Base de datos real)",
            token,
            user: { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol }
        });

    } catch (error) {
        console.error('❌ Error en login:', error);
        res.status(500).json({ message: "Error interno del servidor", error: error.message, database_status: databaseStatus });
    }
});


// ===================== RUTAS CRUD (ADAPTADAS A SUPABASE) =====================

// RUTAS DE PERMISOS
apiRouter.get("/permissions/:employeeId", verificarToken, async (req, res) => {
    if (req.user.rol !== "admin") {
        return res.status(403).json({ message: "Solo los administradores pueden ver permisos" });
    }

    const { employeeId } = req.params;

    try {
        const { data: result, error } = await supabase
            .from('user_permissions')
            .select('permissions')
            .eq('user_id', employeeId)
            .single();

        // PGRST116 es el código de Supabase para "No se encontraron filas"
        if (error && error.code !== 'PGRST116') throw error; 

        if (!result) {
            const defaultPermissions = { /* ... permisos por defecto ... */ };
            return res.json({ permissions: defaultPermissions });
        }

        res.json({ permissions: result.permissions });
    } catch (error) {
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

apiRouter.post("/permissions", verificarToken, async (req, res) => {
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
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// RUTAS DE CLIENTES
apiRouter.get("/clientes", verificarToken, async (req, res) => {
    try {
        const { data: result, error } = await supabase
            .from('clientes')
            .select('*')
            .order('nombre', { ascending: true });

        if (error) throw error;
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener clientes" });
    }
});

apiRouter.get("/clientes/con-deuda", verificarToken, async (req, res) => {
    try {
        const { data: result, error } = await supabase
            .from('clientes')
            .select('id, nombre, rut, telefono, saldo_pendiente')
            .gt('saldo_pendiente', 0)
            .order('nombre', { ascending: true });

        if (error) throw error;
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "No se puede mostrar clientes con deuda" });
    }
});

apiRouter.post("/clientes", verificarToken, async (req, res) => {
    const { rut, nombre, telefono, email, direccion } = req.body;
    if (!nombre || !telefono) {
        return res.status(400).json({ message: "Nombre y teléfono son obligatorios" });
    }

    try {
        const { data: result, error } = await supabase
            .from('clientes')
            .insert({ rut: rut?.trim(), nombre, telefono, email, direccion, saldo_pendiente: 0 })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') { return res.status(400).json({ error: "El RUT ya está registrado" }); }
            throw error;
        }

        res.status(201).json({ ...result, message: "Cliente creado exitosamente" });
    } catch (error) {
        res.status(500).json({ error: "Error al crear cliente" });
    }
});

// RUTAS DE USUARIOS
apiRouter.get("/usuarios", verificarToken, async (req, res) => {
    if (req.user.rol !== "admin") {
        return res.status(403).json({ message: "Solo los administradores pueden ver usuarios" });
    }

    try {
        const { data: result, error } = await supabase
            .from('usuarios')
            .select('id, username, nombre, rol');

        if (error) throw error;
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

apiRouter.post("/usuarios", verificarToken, async (req, res) => {
    if (req.user.rol !== "admin") {
        return res.status(403).json({ message: "Solo los administradores pueden crear usuarios" });
    }

    const { username, nombre, password, rol } = req.body;
    if (!username || !nombre || !password || !rol) {
        return res.status(400).json({ message: "Faltan datos" });
    }

    try {
        const { data: result, error } = await supabase
            .from('usuarios')
            .insert({ username, nombre, password, rol })
            .select('id, username, nombre, rol')
            .single();

        if (error) throw error;
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// ===================== MONTAJE Y EJECUCIÓN =====================

// Nota: Si usas routers externos, descomenta y ajusta esta sección:
// apiRouter.use("/stock", verificarToken, createStockRouter(db.supabaseClient));
// apiRouter.use("/sales", verificarToken, createSalesRouter(db.supabaseClient));

app.use("/api", apiRouter);

// Manejo de errores 404 y 500
app.use((err, req, res, next) => {
    console.error("❌ Error global:", err);
    res.status(500).json({ error: "Error interno del servidor" });
});

app.use((req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor en puerto ${PORT}`);
    console.log(`📊 Estado Supabase: ${databaseStatus}`);
    console.log(`📋 Detalles: ${databaseDetails}`);
});

export default app;