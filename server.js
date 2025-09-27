import express from "express";
import jwt from "jsonwebtoken";
import cors from "cors";
import dotenv from "dotenv";
// Importamos solo el cliente de Supabase, ya no necesitamos 'pg'
import { createClient } from "@supabase/supabase-js"; 

// Importa tus routers externos
import createStockRouter from "./stockRoutes.js";
import createSalesRouter from "./sales.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ===================== CONFIGURACIÓN SUPABASE =====================
let supabase = null;
let databaseStatus = 'Inicializando...'; // Renombrado de supabaseStatus a databaseStatus
let databaseDetails = '';

const initializeSupabase = async () => {
    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_ANON_KEY;
        
        console.log('=== DIAGNÓSTICO SUPABASE ===');
        console.log('URL:', supabaseUrl ? '✅ Presente' : '❌ Faltante');
        console.log('Key:', supabaseKey ? '✅ Presente' : '❌ Faltante');

        if (!supabaseUrl || !supabaseKey) {
            databaseStatus = '❌ Variables faltantes';
            databaseDetails = 'Configura SUPABASE_URL y SUPABASE_ANON_KEY';
            return;
        }

        // Crear cliente de Supabase
        supabase = createClient(supabaseUrl, supabaseKey);
        console.log('✅ Cliente Supabase creado');

        // Prueba de Conexión y Diagnóstico (Usando tabla 'usuarios')
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
            console.error('❌ Error de conexión/prueba de Supabase:', countError);
        } else {
            databaseStatus = '✅ Conectado a PostgreSQL';
            databaseDetails = `Tabla usuarios encontrada. Registros: ${count || 0}`;
            console.log(`✅ Conexión Supabase OK. Registros en usuarios: ${count}`);
        }

    } catch (error) {
        databaseStatus = `❌ Error crítico`;
        databaseDetails = error.message;
        console.error('❌ Error inicializando Supabase:', error);
    }
};

// Iniciar la conexión de Supabase al inicio
initializeSupabase();

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
        console.log("✅ Token verificado. Usuario:", user);
        req.user = user;
        next();
    });
}

// ===================== FUNCIÓN DB (AHORA USA SUPABASE) =====================
// Se simula la función db.query, pero usando el cliente Supabase
const db = {
    // Para simplificar, pasamos el cliente Supabase a los Routers externos si lo necesitan
    supabaseClient: () => supabase,
    // Nota: El stockRouter y salesRouter deberán ser ajustados para usar db.supabaseClient().from(...)
};

// ===================== ENRUTADOR PRINCIPAL DE LA API =====================
const apiRouter = express.Router();

// Rutas estáticas/Diagnóstico (Combina '/' y '/api/health' de los originales)
apiRouter.get("/health", (req, res) => {
    res.json({
        message: '✅ API POS funcionando',
        status: 'OK',
        database: {
            status: databaseStatus,
            details: databaseDetails,
            timestamp: new Date().toISOString()
        }
    });
});

// Ruta de configuración (para el diagnóstico del frontend)
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

// ===================== CONFIGURACIÓN DE ROUTERS =====================
console.log("🔍 Configurando routers...");

// Se asume que estas funciones han sido modificadas para usar el cliente Supabase
// En lugar de pasar 'db' o 'pool', pasamos el cliente Supabase (o un wrapper)
const stockRouter = createStockRouter(db.supabaseClient);
const salesRouter = createSalesRouter(db.supabaseClient);

// ===================== RUTA DE LOGIN (CON SUPABASE) =====================
apiRouter.post("/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: "Usuario y contraseña requeridos" });
    }

    // 1. Verificar estado de Supabase para modo simulación
    if (!supabase || !databaseStatus.includes('✅')) {
        console.log('🔄 Usando modo simulación - Base de datos no disponible');
        // Lógica de simulación (copiada del segundo bloque)
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
        
        return res.status(401).json({ 
            message: "Credenciales incorrectas",
            database_status: databaseStatus,
            hint: "En modo simulación usar: admin/123456 o vendedor/123456"
        });
    }

    // 2. Login con Supabase real
    console.log('📊 Autenticando con Supabase real...');

    try {
        const { data: usuarios, error } = await supabase
            .from('usuarios')
            .select('id, username, nombre, rol')
            .eq('username', username)
            .eq('password', password); // NOTA: Esto es inseguro. Se recomienda HASHING.

        if (error) {
            console.error('❌ Error de Supabase:', error);
            return res.status(500).json({ 
                message: "Error en la base de datos",
                error: error.message,
                database_status: databaseStatus
            });
        }

        if (!usuarios || usuarios.length === 0) {
            return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
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
            user: { id: user.id, username: user.username, rol: user.rol }
        });

    } catch (error) {
        console.error('❌ Error en login:', error);
        res.status(500).json({ 
            message: "Error interno del servidor",
            error: error.message,
            database_status: databaseStatus
        });
    }
});

// ===================== RUTAS CRUD (ADAPTADAS A SUPABASE) =====================

// RUTAS DE PERMISOS
apiRouter.get("/permissions/:employeeId", verificarToken, async (req, res) => {
    // ... Lógica de RLS eliminada ya que no es aplicable a Supabase de esta forma ...

    // Uso de Supabase para obtener permisos
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

        if (error && error.code !== 'PGRST116') { // PGRST116: No rows found
            console.error("Error al obtener permisos:", error);
            throw error;
        }

        if (!result) {
            const defaultPermissions = {
                can_view_products: true, can_edit_products: false, can_delete_products: false,
                can_create_products: false, can_view_sales: true, can_create_sales: true,
                can_view_customers: true, can_edit_customers: false, can_view_reports: false,
                can_manage_stock: false
            };
            return res.json({ permissions: defaultPermissions });
        }

        res.json({ permissions: result.permissions });
    } catch (error) {
        console.error("Error al obtener permisos:", error);
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
        // Upsert en Supabase para insertar o actualizar permisos
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

// NUEVA RUTA para obtener clientes con deuda
apiRouter.get("/clientes/con-deuda", verificarToken, async (req, res) => {
    console.log("🔍 SOLICITUD RECIBIDA: Obtener clientes con deuda");
    try {
        const { data: result, error } = await supabase
            .from('clientes')
            .select('id, nombre, rut, telefono, saldo_pendiente')
            .gt('saldo_pendiente', 0) // gt = greater than (>)
            .order('nombre', { ascending: true });

        if (error) throw error;

        console.log(`✅ ${result.length} clientes con deuda encontrados.`);
        res.json(result);
    } catch (error) {
        console.error("❌ ERROR al obtener clientes con deuda:", error);
        res.status(500).json({
            error: "No se puede mostrar clientes con deuda",
            message: error.message
        });
    }
});

apiRouter.post("/clientes", verificarToken, async (req, res) => {
    const { rut, nombre, telefono, email, direccion } = req.body;

    if (!nombre || !telefono) {
        return res.status(400).json({ message: "Nombre y teléfono son obligatorios" });
    }

    try {
        const insertData = {
            rut: rut?.trim(), // Supabase maneja 'null' o 'undefined'
            nombre,
            telefono,
            email,
            direccion,
            saldo_pendiente: 0
        };

        const { data: result, error } = await supabase
            .from('clientes')
            .insert([insertData])
            .select()
            .single();

        if (error) {
            // Manejo de error de unicidad (si el rut es único)
            if (error.code === '23505') { 
                return res.status(400).json({ error: "El RUT ya está registrado" });
            }
            throw error;
        }

        res.status(201).json({
            ...result,
            message: "Cliente creado exitosamente"
        });
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

// ===================== MONTAJE DEL ROUTER =====================
app.use("/api", apiRouter);

// ===================== ERRORES =====================
app.use((err, req, res, next) => {
    console.error("❌ Error global:", err);
    res.status(500).json({ error: "Error interno del servidor" });
});

app.use((req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
});

// ===================== INICIAR SERVIDOR =====================
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor en ejecución en http://localhost:${PORT}`);
    console.log(`🔍 JWT_SECRET: ${process.env.JWT_SECRET || "clave_secreta"}`);
    console.log(`🗄️  Base de datos: ${databaseStatus}`);
    console.log(`📋 Detalles: ${databaseDetails}`);
});

export default app;