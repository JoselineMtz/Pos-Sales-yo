import express from "express";

const createSalesRouter = (pool) => {
  const router = express.Router();

  // ===================== MIDDLEWARE DE VERIFICACIÓN DE PERMISOS =====================
  const verificarPermisosVentas = (permisoRequerido) => {
    return async (req, res, next) => {
      console.log("🔍 Verificando permisos para ventas:", req.user);

      if (req.user.rol === "admin") {
        console.log("✅ Usuario es admin, acceso concedido");
        return next();
      }

      if (req.user.rol === "vendedor") {
        try {
          const result = await pool.query(
            "SELECT permissions FROM user_permissions WHERE user_id = $1",
            [req.user.id]
          );

          let userPermissions = {};

          if (result.rows.length > 0) {
            userPermissions = result.rows[0].permissions;
          } else {
            userPermissions = {
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
          }

          console.log("🔍 Permisos del usuario para ventas:", userPermissions);

          if (userPermissions[permisoRequerido]) {
            console.log(`✅ Permiso ${permisoRequerido} concedido para ventas`);
            next();
          } else {
            console.log(`❌ Permiso ${permisoRequerido} denegado para ventas`);
            res.status(403).json({
              message: "No tienes permisos para realizar esta acción"
            });
          }
        } catch (error) {
          console.error("Error al verificar permisos:", error);
          return res.status(500).json({ error: "Error interno del servidor" });
        }
      } else {
        console.log(`❌ Rol no reconocido: ${req.user.rol}`);
        res.status(403).json({ message: "Acceso denegado" });
      }
    };
  };

  // ===================== REGISTRAR NUEVA VENTA =====================

router.post("/", verificarPermisosVentas("can_create_sales"), async (req, res) => {
    console.log("🛒 REGISTRANDO NUEVA VENTA - Datos recibidos:", JSON.stringify(req.body, null, 2));

    const {
        total,
        recibido,
        cambio,
        metodo_pago,
        cliente_id, // Puede ser null
        deuda = 0,
        user_id,
        items = [],
        transfer = null,
    } = req.body;

    // Validaciones
    if (total == null || recibido == null || cambio == null || !metodo_pago || !user_id || !Array.isArray(items)) {
        return res.status(400).json({ error: "Datos de venta incompletos o inválidos" });
    }

    // Asegurarse de que los valores null se pasen correctamente a la consulta
    const clienteIdFinal = cliente_id ? parseInt(cliente_id) : null;
    const titular = transfer?.titular || null;
    const banco = transfer?.banco || null;
    const deudaFinal = parseFloat(deuda) || 0;

    console.log("🔍 Procesando venta con cliente_id:", clienteIdFinal);
    console.log("🔍 Procesando venta con deuda:", { deuda: deudaFinal, cliente_id: clienteIdFinal });

    let client;
    try {
        client = await pool.connect();
        console.log("✅ Conexión a BD obtenida");

        await client.query('BEGIN');
        console.log("✅ Transacción iniciada");

        // Insertar venta CON la deuda
        const ventaQuery = `
            INSERT INTO ventas
            (total, recibido, cambio, metodo_pago, cliente_id, deuda, user_id, titular_transferencia, banco_transferencia)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id, deuda
        `;

        const ventaResult = await client.query(ventaQuery, [
            total,
            recibido,
            cambio,
            metodo_pago,
            clienteIdFinal, // Aquí se usa el valor que puede ser null
            deudaFinal,
            user_id,
            titular, // Puede ser null
            banco,   // Puede ser null
        ]);

        const ventaId = ventaResult.rows[0].id;
        const deudaGuardada = ventaResult.rows[0].deuda;

        console.log("✅ Venta registrada con ID:", ventaId, "Deuda guardada:", deudaGuardada);

        // Procesar items
        for (const item of items) {
            console.log("🔍 Procesando item:", item);
            
            const productoResult = await client.query(
                "SELECT name, purchase_price, stock FROM productos WHERE id = $1",
                [item.producto_id]
            );

            if (productoResult.rows.length === 0) {
                throw new Error(`Producto con ID ${item.producto_id} no encontrado`);
            }

            const producto = productoResult.rows[0];

            if (item.cantidad > producto.stock) {
                throw new Error(`Stock insuficiente para ${producto.name}`);
            }

            // Insertar detalle de venta
            await client.query(
                "INSERT INTO venta_detalles (venta_id, producto_id, cantidad, precio, purchase_price) VALUES ($1, $2, $3, $4, $5)",
                [ventaId, item.producto_id, item.cantidad, item.precio, producto.purchase_price]
            );

            // Actualizar stock
            await client.query(
                "UPDATE productos SET stock = stock - $1 WHERE id = $2",
                [item.cantidad, item.producto_id]
            );
        }

        // ACTUALIZAR SALDO DEL CLIENTE SI HAY DEUDA
        if (clienteIdFinal && deudaFinal > 0) {
            console.log("💰 Actualizando saldo del cliente por deuda:", {
                cliente_id: clienteIdFinal,
                deuda: deudaFinal
            });

            // Código para actualizar el saldo del cliente... (sin cambios)
            const clienteExists = await client.query(
                "SELECT id, nombre FROM clientes WHERE id = $1",
                [clienteIdFinal]
            );

            if (clienteExists.rows.length === 0) {
                console.log("⚠️ Cliente no encontrado, omitiendo actualización de saldo");
            } else {
                console.log("👤 Cliente encontrado:", clienteExists.rows[0].nombre);

                // Permisos...
                if (req.user.rol === "vendedor") {
                    const permisosResult = await client.query(
                        "SELECT permissions FROM user_permissions WHERE user_id = $1",
                        [req.user.id]
                    );

                    let userPermissions = { can_edit_customers: false };
                    if (permisosResult.rows.length > 0) {
                        userPermissions = permisosResult.rows[0].permissions;
                    }

                    if (!userPermissions.can_edit_customers) {
                        console.log("⚠️ Vendedor no tiene permiso para editar clientes, omitiendo actualización de saldo");
                    } else {
                        await client.query(
                            "UPDATE clientes SET saldo_pendiente = saldo_pendiente + $1 WHERE id = $2",
                            [deudaFinal, clienteIdFinal]
                        );
                        console.log("✅ Saldo del cliente actualizado por deuda");
                    }
                } else {
                    await client.query(
                        "UPDATE clientes SET saldo_pendiente = saldo_pendiente + $1 WHERE id = $2",
                        [deudaFinal, clienteIdFinal]
                    );
                    console.log("✅ Saldo del cliente actualizado por deuda (admin)");
                }
            }
        }

        await client.query('COMMIT');
        console.log("✅ Transacción confirmada");

        res.json({
            success: true,
            venta_id: ventaId,
            deuda_guardada: deudaGuardada,
            message: "Venta registrada exitosamente"
        });

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK');
            console.log("🔁 Transacción revertida");
        }

        console.error("❌ ERROR al registrar venta:", error.message);

        res.status(500).json({
            error: "Error al registrar venta",
            message: error.message
        });
    } finally {
        if (client) {
            client.release();
            console.log("🔗 Conexión liberada");
        }
    }
});
  // ===================== REGISTRAR PAGO DE DEUDA =====================
  router.post("/:id/pagar-deuda", verificarPermisosVentas("can_create_sales"), async (req, res) => {
    const { id } = req.params;
    const { monto } = req.body;

    console.log("💳 SOLICITUD DE PAGO DE DEUDA - Venta ID:", id, "Monto:", monto, "Usuario:", req.user);

    // Validaciones
    if (!monto || isNaN(monto) || monto <= 0) {
      return res.status(400).json({ error: "Monto inválido" });
    }

    let client;
    try {
      client = await pool.connect();
      console.log("✅ Conexión a BD obtenida para pago de deuda");

      // 1. Obtener información de la venta
      const ventaResult = await client.query(
        "SELECT id, cliente_id, deuda, user_id FROM ventas WHERE id = $1",
        [id]
      );

      if (ventaResult.rows.length === 0) {
        return res.status(404).json({ error: "Venta no encontrada" });
      }

      const venta = ventaResult.rows[0];
      const deudaActual = parseFloat(venta.deuda) || 0;

      console.log("🔍 Información de la venta:", {
        venta_id: venta.id,
        deuda_actual: deudaActual,
        cliente_id: venta.cliente_id
      });

      if (deudaActual <= 0) {
        return res.status(400).json({ error: "La venta no tiene deuda pendiente" });
      }

      // Verificar permisos
      if (req.user.rol !== "admin" && parseInt(venta.user_id) !== req.user.id) {
        return res.status(403).json({ error: "No puedes modificar ventas de otros usuarios" });
      }

      const pago = Math.min(parseFloat(monto), deudaActual);
      const nuevaDeuda = deudaActual - pago;

      console.log("💰 Calculando pago:", {
        monto_solicitado: monto,
        pago_a_registrar: pago,
        deuda_anterior: deudaActual,
        deuda_nueva: nuevaDeuda
      });

      await client.query('BEGIN');
      console.log("✅ Transacción iniciada para pago");

      // 2. Actualizar deuda en la venta
      await client.query(
        "UPDATE ventas SET deuda = $1 WHERE id = $2",
        [nuevaDeuda, id]
      );
      console.log("✅ Deuda actualizada en venta");

      // 3. Actualizar saldo del cliente si existe
      let clienteActualizado = false;
      if (venta.cliente_id) {
        console.log("👤 Actualizando saldo del cliente ID:", venta.cliente_id);

        // Verificar permisos para editar clientes
        if (req.user.rol === "vendedor") {
          const permisosResult = await client.query(
            "SELECT permissions FROM user_permissions WHERE user_id = $1",
            [req.user.id]
          );

          let userPermissions = { can_edit_customers: false };
          if (permisosResult.rows.length > 0) {
            userPermissions = permisosResult.rows[0].permissions;
          }

          if (!userPermissions.can_edit_customers) {
            console.log("⚠️ Vendedor no tiene permiso para editar clientes, omitiendo actualización de saldo");
          } else {
            await client.query(
              "UPDATE clientes SET saldo_pendiente = saldo_pendiente - $1 WHERE id = $2",
              [pago, venta.cliente_id]
            );
            clienteActualizado = true;
            console.log("✅ Saldo del cliente actualizado");
          }
        } else {
          await client.query(
            "UPDATE clientes SET saldo_pendiente = saldo_pendiente - $1 WHERE id = $2",
            [pago, venta.cliente_id]
          );
          clienteActualizado = true;
          console.log("✅ Saldo del cliente actualizado (admin)");
        }
      } else {
        console.log("ℹ️ Venta sin cliente asociado, omitiendo actualización de saldo");
      }

      await client.query('COMMIT');
      console.log("✅ Transacción de pago confirmada");

      res.json({
        success: true,
        pago_registrado: pago,
        deuda_anterior: deudaActual,
        deuda_actualizada: nuevaDeuda,
        cliente_actualizado: clienteActualizado,
        message: "Pago de deuda registrado exitosamente"
      });

    } catch (error) {
      if (client) {
        await client.query('ROLLBACK');
        console.log("🔁 Transacción revertida por error");
      }

      console.error("❌ ERROR al procesar pago de deuda:", error.message);
      console.error("❌ Stack trace:", error.stack);

      res.status(500).json({
        error: "Error al procesar pago de deuda",
        message: error.message
      });
    } finally {
      if (client) {
        client.release();
        console.log("🔗 Conexión liberada");
      }
    }
  });

// ===================== OBTENER VENTAS =====================
router.get("/", verificarPermisosVentas("can_view_sales"), async (req, res) => {
    console.log("🔍 SOLICITUD RECIBIDA: Obtener ventas");

    const { filtro } = req.query; // Obtener el parámetro de filtro

    let client;
    try {
        client = await pool.connect();

        let query = `
            SELECT
                v.*,
                c.nombre as cliente_nombre,
                c.rut as cliente_rut,
                u.nombre as user_nombre
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            LEFT JOIN usuarios u ON v.user_id = u.id
        `;
        let params = [];
        let conditions = [];

        // 1. Manejar permisos de vendedor
        if (req.user.rol === "vendedor") {
            conditions.push(`v.user_id = $${conditions.length + 1}`);
            params.push(req.user.id);
        }

        // 2. Manejar filtro por fecha
        if (filtro === "hoy") {
            conditions.push(`v.fecha >= CURRENT_DATE AND v.fecha < CURRENT_DATE + INTERVAL '1 day'`);
        } else if (filtro === "semana") {
            conditions.push(`v.fecha >= date_trunc('week', CURRENT_DATE) AND v.fecha < date_trunc('week', CURRENT_DATE) + INTERVAL '1 week'`);
        } else if (filtro === "mes") {
            conditions.push(`v.fecha >= date_trunc('month', CURRENT_DATE) AND v.fecha < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'`);
        } else if (filtro === "anio") {
            conditions.push(`v.fecha >= date_trunc('year', CURRENT_DATE) AND v.fecha < date_trunc('year', CURRENT_DATE) + INTERVAL '1 year'`);
        }

        // Construir la cláusula WHERE
        if (conditions.length > 0) {
            query += " WHERE " + conditions.join(" AND ");
        }

        query += " ORDER BY v.fecha DESC";

        console.log("🛠️  Ejecutando consulta:", { query, params });

        const result = await client.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error("❌ Error al obtener ventas:", error.message);
        res.status(500).json({ error: "Error al obtener ventas", message: error.message });
    } finally {
        if (client) {
            client.release();
        }
    }
});

  // ===================== OBTENER DETALLES DE VENTA =====================
 router.get("/:id/detalles", verificarPermisosVentas("can_view_sales"), async (req, res) => {
    const { id } = req.params; // Captura el ID de la URL
    console.log("🔍 SOLICITUD RECIBIDA: Obtener detalles para venta ID:", id);

    // Validación básica para evitar errores
    if (!id || isNaN(id)) {
        return res.status(400).json({ error: "ID de venta inválido" });
    }

    try {
        const detallesResult = await pool.query(`
            SELECT vd.*, p.name as producto_nombre, p.sku
            FROM venta_detalles vd
            JOIN productos p ON vd.producto_id = p.id
            WHERE vd.venta_id = $1
        `, [id]); // Asegúrate de pasar el ID como un parámetro

        if (detallesResult.rows.length === 0) {
            console.log("⚠️ No se encontraron detalles para la venta ID:", id);
        }

        res.json(detallesResult.rows);
    } catch (error) {
        console.error("❌ Error al obtener detalles de venta:", error.message);
        res.status(500).json({
            error: "Error al obtener detalles de venta",
            message: error.message
        });
    }
});


  // --- NUEVA RUTA: OBTENER CLIENTES CON DEUDA PENDIENTE ---
  router.get("/clientes/con-deuda", verificarPermisosVentas("can_view_customers"), async (req, res) => {
    console.log("🔍 SOLICITUD RECIBIDA: Obtener clientes con deuda");
    try {
      const query = `
        SELECT id, nombre, rut, telefono, saldo_pendiente
        FROM clientes
        WHERE saldo_pendiente > 0
        ORDER BY nombre ASC
      `;
      const result = await pool.query(query);

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
  // --- FIN DE NUEVA RUTA ---

  return router;
};

export default createSalesRouter;