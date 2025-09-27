import express from "express";
import pkg from 'pg';
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
// Importar routers externos (asegúrate de que existan)
import createStockRouter from "./stockRoutes.js";
import createSalesRouter from "./sales.js";

const { Pool } = pkg;
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 🔍 Logging de requests (del segundo archivo)
app.use((req, res, next) => {
    console.log(`🔍 [${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
});

// ===================== CONEXIÓN POSTGRESQL (del segundo archivo) =====================
const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "peluche1",
    database: process.env.DB_NAME || "ventas_bd",
    port: process.env.DB_PORT || 5433,
});

// Verificar conexión a PostgreSQL
pool.on('connect', () => {
    console.log("✅ Conectado a PostgreSQL");
});

pool.on('error', (err) => {
    console.error("❌ Error de conexión PostgreSQL:", err);
});

// Función helper para ejecutar queries
const db = {
    query: (text, params) => pool.query(text, params),
};

// ===================== MIDDLEWARE JWT (del segundo archivo) =====================
function verificarToken(req, res, next) {
    const authHeader = req.headers["authorization"];

    if (!authHeader) {
        return res.status(401).json({ message: "Token no proporcionado" });
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
        return res.status(401).json({ message: "Formato de token inválido. Use: Bearer <token>" });
    }

    const token = parts[1];

    if (!token) {
        return res.status(401).json({ message: "Token no proporcionado" });
    }

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

// ===================== ENRUTADOR PRINCIPAL DE LA API =====================
const apiRouter = express.Router();

// Health check (una combinación del check de ambos archivos)
app.get('/', (req, res) => {
    res.json({ 
        message: '✅ API POS funcionando',
        status: 'OK',
        database: process.env.DB_NAME ? 'PostgreSQL Conectado' : 'Configuración Pendiente',
        timestamp: new Date().toISOString()
    });
});

// Ruta estática del segundo archivo
apiRouter.get("/health", (req, res) => {
    res.json({
        message: "Servidor funcionando correctamente",
        timestamp: new Date().toISOString(),
        database: process.env.DB_NAME || "ventas_bd",
    });
});


// ===================== RUTA DE LOGIN (Modificada para ser Híbrida) =====================
const SIMULATION_MODE = !process.env.DB_HOST || !process.env.DB_USER; // Puedes ajustar esta lógica
if (SIMULATION_MODE) {
    console.log('⚠️  Modo simulación activado para el Login (Sin DB Configurada)');
}

apiRouter.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: "Usuario y contraseña requeridos" });
        }

        // Modo simulación (del primer archivo)
        if (SIMULATION_MODE) {
            if (username === 'admin' && password === '123456') {
                const token = jwt.sign(
                    { id: 1, username: 'admin', rol: 'admin' },
                    process.env.JWT_SECRET || "clave_secreta",
                    { expiresIn: "8h" }
                );
                
                return res.json({
                    message: "Login exitoso (modo simulación)",
                    token,
                    user: { id: 1, username: 'admin', rol: 'admin' }
                });
            } else {
                return res.status(401).json({ message: "Credenciales incorrectas" });
            }
        }

        // Modo real con PostgreSQL (del segundo archivo)
        const result = await db.query(
            "SELECT id, username, nombre, rol, password FROM usuarios WHERE username = $1 AND password = $2",
            [username, password]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
        }

        const user = result.rows[0];
        const token = jwt.sign(
            { id: user.id, username: user.username, rol: user.rol },
            process.env.JWT_SECRET || "clave_secreta",
            { expiresIn: "8h" }
        );

        res.json({
            message: "Login exitoso",
            token,
            user: { id: user.id, username: user.username, rol: user.rol, nombre: user.nombre }
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ message: "Error interno del servidor" });
    }
});


// ===================== CONFIGURACIÓN DE ROUTERS (del segundo archivo) =====================
console.log("🔍 Configurando routers...");

// Stock router (solo necesita consultas simples)
const stockRouter = createStockRouter(db);
apiRouter.use("/stock", verificarToken, stockRouter);

// Sales router (necesita transacciones - pasa el pool)
const salesRouter = createSalesRouter(pool);
apiRouter.use("/sales", verificarToken, salesRouter);


// ===================== RUTAS DE PERMISOS (del segundo archivo) =====================
apiRouter.get("/permissions/:employeeId", verificarToken, async (req, res) => {
    console.log("🔹 Usuario intentando obtener permisos:", req.user);

    if (req.user.rol !== "admin") {
        return res.status(403).json({ message: "Solo los administradores pueden ver permisos" });
    }

    const { employeeId } = req.params;

    try {
        const result = await db.query(
            "SELECT permissions FROM user_permissions WHERE user_id = $1",
            [employeeId]
        );

        if (result.rows.length === 0) {
            const defaultPermissions = {
                can_view_products: true,
                can_edit_products: false,
                can_delete_products: false,
                can_create_products: false,
                can_view_sales: true,
                can_create_sales: true,
                can_view_customers: true,
                can_edit_customers: false,
                can_view_reports: false,
                can_manage_stock: false
            };
            return res.json({ permissions: defaultPermissions });
        }

        // Nota: Asumiendo que `permissions` es de tipo JSONB en tu DB.
        res.json({ permissions: result.rows[0].permissions });
    } catch (error) {
        console.error("Error al obtener permisos:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

apiRouter.post("/permissions", verificarToken, async (req, res) => {
    console.log("🔹 Usuario intentando guardar permisos:", req.user);

    if (req.user.rol !== "admin") {
        return res.status(403).json({ message: "Solo los administradores pueden modificar permisos" });
    }

    const { employee_id, permissions } = req.body;

    if (!employee_id || !permissions) {
        return res.status(400).json({ message: "Datos incompletos" });
    }

    try {
        const query = `
      INSERT INTO user_permissions (user_id, permissions)
      VALUES ($1, $2)
      ON CONFLICT (user_id)
      DO UPDATE SET permissions = $2
    `;

        await db.query(query, [employee_id, permissions]);
        res.json({ message: "Permisos guardados correctamente" });
    } catch (error) {
        console.error("Error al guardar permisos:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// ===================== RUTAS DE CLIENTES (del segundo archivo) =====================
apiRouter.get("/clientes", verificarToken, async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM clientes ORDER BY nombre");
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener clientes" });
    }
});

apiRouter.get("/clientes/con-deuda", verificarToken, async (req, res) => {
    console.log("🔍 SOLICITUD RECIBIDA: Obtener clientes con deuda");
    try {
        const query = `
            SELECT id, nombre, rut, telefono, saldo_pendiente
            FROM clientes
            WHERE saldo_pendiente > 0
            ORDER BY nombre ASC
        `;
        const result = await db.query(query);

        console.log(`✅ ${result.rows.length} clientes con deuda encontrados.`);
        res.json(result.rows);
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
        let query, params;

        if (rut?.trim()) {
            query = `INSERT INTO clientes (rut, nombre, telefono, email, direccion, saldo_pendiente) VALUES ($1, $2, $3, $4, $5, 0) RETURNING *`;
            params = [rut.trim(), nombre, telefono, email, direccion];
        } else {
            query = `INSERT INTO clientes (nombre, telefono, email, direccion, saldo_pendiente) VALUES ($1, $2, $3, $4, 0) RETURNING *`;
            params = [nombre, telefono, email, direccion];
        }

        const result = await db.query(query, params);
        res.status(201).json({
            ...result.rows[0],
            message: "Cliente creado exitosamente"
        });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: "El RUT ya está registrado" });
        }
        res.status(500).json({ error: "Error al crear cliente" });
    }
});

// ===================== RUTAS DE USUARIOS (del segundo archivo) =====================
apiRouter.get("/usuarios", verificarToken, async (req, res) => {
    if (req.user.rol !== "admin") {
        return res.status(403).json({ message: "Solo los administradores pueden ver usuarios" });
    }

    try {
        const result = await db.query("SELECT id, username, nombre, rol FROM usuarios");
        res.json(result.rows);
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
        const result = await db.query(
            "INSERT INTO usuarios (username, nombre, password, rol) VALUES ($1, $2, $3, $4) RETURNING id, username, nombre, rol",
            [username, nombre, password, rol]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: "Error interno del servidor" });
    }
});


// ===================== MONTAJE DEL ROUTER =====================
app.use("/api", apiRouter);

// ===================== ERRORES (del segundo archivo) =====================
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
    console.log(`🗄️  Base de datos: ${SIMULATION_MODE ? 'MODO SIMULACIÓN' : process.env.DB_NAME || "ventas_bd"}`);
});

export default app;