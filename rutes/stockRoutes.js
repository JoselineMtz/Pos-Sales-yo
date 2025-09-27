import express from "express";
import { db } from '../server.js';

const router = express.Router();

const createStockRouter = (db, verifyToken = (req, res, next) => next()) => {
  // ===================== MIDDLEWARE DE VERIFICACIÓN DE PERMISOS =====================
  const verificarPermisosStock = (permisoRequerido) => {
    return async (req, res, next) => {
      console.log("🔍 Verificando permisos para stock:", req.user);
      
      if (req.user.rol === "admin") {
        console.log("✅ Usuario es admin, acceso concedido");
        return next();
      }
      
      if (req.user.rol === "vendedor") {
        try {
          const result = await db.query(
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
          
          console.log("🔍 Permisos del usuario para stock:", userPermissions);
          
          if (userPermissions[permisoRequerido]) {
            console.log(`✅ Permiso ${permisoRequerido} concedido para stock`);
            next();
          } else {
            console.log(`❌ Permiso ${permisoRequerido} denegado para stock`);
            res.status(403).json({ 
              message: "No tienes permisos para realizar esta acción",
              requiredPermission: permisoRequerido
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

  // ===================== PRODUCTOS =====================
  router.get("/products", verifyToken, verificarPermisosStock("can_view_products"), async (req, res) => {
    try {
      const query = `
        SELECT p.*, c.nombre AS categoria_nombre
        FROM productos p
        LEFT JOIN categorias c ON p.categoria_id = c.id
      `;
      const result = await db.query(query);
      res.json(result.rows);
    } catch (err) {
      console.error("Error al obtener productos:", err);
      res.status(500).json({ error: "Error de servidor" });
    }
  });

  router.get("/products/by-sku/:sku", verifyToken, verificarPermisosStock("can_view_products"), async (req, res) => {
    const { sku } = req.params;
    try {
      const query = `
        SELECT p.*, c.nombre AS categoria_nombre
        FROM productos p
        LEFT JOIN categorias c ON p.categoria_id = c.id
        WHERE p.sku = $1
      `;
      const result = await db.query(query, [sku]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Producto no encontrado" });
      }
      res.json(result.rows[0]);
    } catch (err) {
      console.error("Error al obtener producto por SKU:", err);
      res.status(500).json({ error: "Error de servidor" });
    }
  });

  // ===================== CATEGORÍAS =====================
  router.get("/categories", verifyToken, verificarPermisosStock("can_view_products"), async (req, res) => {
    try {
      const result = await db.query("SELECT * FROM categorias");
      res.json(result.rows);
    } catch (err) {
      console.error("Error al obtener categorías:", err);
      res.status(500).json({ error: "Error de servidor" });
    }
  });

  router.post("/categories", verifyToken, verificarPermisosStock("can_create_products"), async (req, res) => {
    const { nombre } = req.body;
    if (!nombre) {
      return res.status(400).json({ message: "El nombre de la categoría es requerido" });
    }
    
    try {
      const result = await db.query(
        "INSERT INTO categorias (nombre) VALUES ($1) RETURNING id, nombre",
        [nombre]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Error al crear categoría:", err);
      res.status(500).json({ error: "Error de servidor" });
    }
  });

  router.delete("/categories/:id", verifyToken, verificarPermisosStock("can_delete_products"), async (req, res) => {
    const { id } = req.params;
    
    try {
      // Verificar si la categoría existe
      const categoriaResult = await db.query(
        "SELECT COUNT(*) AS count FROM categorias WHERE id = $1", 
        [id]
      );
      
      if (parseInt(categoriaResult.rows[0].count) === 0) {
        return res.status(404).json({ message: "Categoría no encontrada" });
      }

      // Eliminar productos asociados
      const deleteProductsResult = await db.query(
        "DELETE FROM productos WHERE categoria_id = $1",
        [id]
      );

      // Eliminar categoría
      await db.query("DELETE FROM categorias WHERE id = $1", [id]);

      res.json({
        message: `Categoría y ${deleteProductsResult.rowCount} productos asociados eliminados correctamente.`,
      });
    } catch (err) {
      console.error("Error al eliminar categoría:", err);
      res.status(500).json({ error: "Error de servidor" });
    }
  });

  // ===================== UPSERT PRODUCTO =====================
  router.post("/products/upsert", verifyToken, verificarPermisosStock("can_create_products"), async (req, res) => {
    console.log("🔍 DEBUG - Datos recibidos en upsert:", req.body);
    
    const { sku, name, description, price, stock, stockUnit, user_id, categoria_id, purchase_price } = req.body;
    const last_updated = new Date();

    if (!sku) {
      return res.status(400).json({ message: "El SKU del producto es requerido" });
    }

    try {
      const existingResult = await db.query(
        "SELECT id FROM productos WHERE sku = $1", 
        [sku]
      );

      const permisoRequerido = existingResult.rows.length > 0 ? "can_edit_products" : "can_create_products";
      
      if (req.user.rol === "vendedor") {
        const permisosResult = await db.query(
          "SELECT permissions FROM user_permissions WHERE user_id = $1", 
          [req.user.id]
        );
        
        let userPermissions = {};
        if (permisosResult.rows.length > 0) {
          userPermissions = permisosResult.rows[0].permissions;
        } else {
          userPermissions = {
            can_view_products: true,
            can_edit_products: false,
            can_delete_products: false,
            can_create_products: false
          };
        }
        
        if (!userPermissions[permisoRequerido]) {
          const accion = existingResult.rows.length > 0 ? "editar" : "crear";
          return res.status(403).json({ 
            message: `No tienes permisos para ${accion} productos`,
            requiredPermission: permisoRequerido
          });
        }
      }

      if (existingResult.rows.length > 0) {
        const id = existingResult.rows[0].id;
        const fieldsToUpdate = [];
        const valuesToUpdate = [];
        let paramCount = 1;

        if (name !== undefined) {
          fieldsToUpdate.push(`name = $${paramCount}`);
          valuesToUpdate.push(name);
          paramCount++;
        }
        if (description !== undefined) {
          fieldsToUpdate.push(`description = $${paramCount}`);
          valuesToUpdate.push(description);
          paramCount++;
        }
        if (price !== undefined) {
          fieldsToUpdate.push(`price = $${paramCount}`);
          valuesToUpdate.push(price);
          paramCount++;
        }
        if (stock !== undefined) {
          fieldsToUpdate.push(`stock = $${paramCount}`);
          valuesToUpdate.push(stock);
          paramCount++;
        }
        if (stockUnit !== undefined) {
          fieldsToUpdate.push(`stock_unit = $${paramCount}`);
          valuesToUpdate.push(stockUnit);
          paramCount++;
        }
        if (user_id !== undefined) {
          fieldsToUpdate.push(`user_id = $${paramCount}`);
          valuesToUpdate.push(user_id);
          paramCount++;
        }
        if (categoria_id !== undefined) {
          fieldsToUpdate.push(`categoria_id = $${paramCount}`);
          valuesToUpdate.push(categoria_id);
          paramCount++;
        }
        if (purchase_price !== undefined) {
          fieldsToUpdate.push(`purchase_price = $${paramCount}`);
          valuesToUpdate.push(purchase_price);
          paramCount++;
        }

        fieldsToUpdate.push(`last_updated = $${paramCount}`);
        valuesToUpdate.push(last_updated);
        paramCount++;

        valuesToUpdate.push(id);

        const updateQuery = `UPDATE productos SET ${fieldsToUpdate.join(", ")} WHERE id = $${paramCount}`;
        await db.query(updateQuery, valuesToUpdate);
        
        res.json({ 
          id, 
          ...req.body, 
          last_updated, 
          message: "Producto actualizado" 
        });
        
      } else {
        if (!name || !price || stock === undefined || !user_id || !stockUnit) {
          return res.status(400).json({ message: "Faltan datos requeridos para crear un nuevo producto" });
        }

        const finalPurchasePrice = purchase_price !== undefined ? purchase_price : price * 0.7;
        const insertQuery = `
          INSERT INTO productos (sku, name, description, price, stock, stock_unit, user_id, categoria_id, last_updated, purchase_price) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
          RETURNING id
        `;
        const values = [sku, name, description, price, stock, stockUnit, user_id, categoria_id, last_updated, finalPurchasePrice];

        const result = await db.query(insertQuery, values);
        
        res.status(201).json({ 
          id: result.rows[0].id, 
          ...req.body, 
          purchase_price: finalPurchasePrice,
          last_updated, 
          message: "Producto creado" 
        });
      }
    } catch (err) {
      console.error("Error en upsert producto:", err);
      res.status(500).json({ error: "Error de servidor al procesar producto" });
    }
  });

  // ===================== ELIMINAR PRODUCTO =====================
  router.delete("/products/:id", verifyToken, verificarPermisosStock("can_delete_products"), async (req, res) => {
    const { id } = req.params;
    try {
      const result = await db.query("DELETE FROM productos WHERE id = $1", [id]);
      
      if (result.rowCount === 0) {
        return res.status(404).json({ message: "Producto no encontrado" });
      }
      
      res.json({ message: "Producto eliminado" });
    } catch (err) {
      console.error("Error al eliminar producto:", err);
      res.status(500).json({ error: "Error de servidor" });
    }
  });

  // ===================== PRODUCTOS TEMPORALES =====================
  router.get("/temp-products/:sessionId", verifyToken, verificarPermisosStock("can_view_products"), async (req, res) => {
    const { sessionId } = req.params;
    try {
      const result = await db.query(
        "SELECT * FROM temp_productos WHERE session_id = $1", 
        [sessionId]
      );
      res.json(result.rows);
    } catch (err) {
      console.error("Error al obtener productos temporales:", err);
      res.status(500).json({ error: "Error de servidor" });
    }
  });

  router.post("/temp-products", verifyToken, verificarPermisosStock("can_create_products"), async (req, res) => {
    const { sessionId, sku, name, description, price, stock, stockUnit, categoria_id, added_stock, purchase_price, user_id } = req.body;
    
    if (!sessionId || !sku || !added_stock || !purchase_price) {
      return res.status(400).json({ message: "Faltan datos clave" });
    }
    
    const last_updated = new Date();
    
    try {
      const query = `
        INSERT INTO temp_productos (session_id, sku, name, description, price, stock, stock_unit, categoria_id, added_stock, purchase_price, user_id, last_updated)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `;
      const values = [
        sessionId, sku, name || "", description || "", price || 0, stock || 0, 
        stockUnit || "Unidad", categoria_id || null, added_stock, purchase_price, 
        user_id || null, last_updated
      ];
      
      const result = await db.query(query, values);
      res.status(201).json({ id: result.rows[0].id, ...req.body, last_updated });
    } catch (err) {
      console.error("Error al crear producto temporal:", err);
      res.status(500).json({ error: "Error de servidor" });
    }
  });

  router.delete("/temp-products/:sessionId", verifyToken, verificarPermisosStock("can_delete_products"), async (req, res) => {
    const { sessionId } = req.params;
    try {
      const result = await db.query(
        "DELETE FROM temp_productos WHERE session_id = $1", 
        [sessionId]
      );
      res.json({ message: `${result.rowCount} productos temporales eliminados.` });
    } catch (err) {
      console.error("Error al eliminar productos temporales:", err);
      res.status(500).json({ error: "Error de servidor" });
    }
  });

  // ===================== FINALIZAR PROCESO =====================
  router.post("/finalize", verifyToken, verificarPermisosStock("can_create_products"), async (req, res) => {
    console.log("🔍 FINALIZE - Datos recibidos:", req.body);
    
    const { products, sessionId } = req.body;
    
    if (!products || !Array.isArray(products) || !sessionId) {
      return res.status(400).json({ message: "Faltan datos requeridos" });
    }

    console.log(`🔍 Procesando ${products.length} productos para finalizar`);

    try {
      for (const product of products) {
        console.log("🔍 Procesando producto:", product);
        
        const last_updated = new Date();
        
        if (!product.sku || product.added_stock === undefined) {
          console.error("❌ Producto inválido:", product);
          continue;
        }

        const query = `
          INSERT INTO productos (sku, name, description, price, stock, stock_unit, user_id, categoria_id, last_updated, purchase_price)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (sku) 
          DO UPDATE SET
            stock = productos.stock + EXCLUDED.stock,
            price = EXCLUDED.price,
            last_updated = EXCLUDED.last_updated,
            purchase_price = EXCLUDED.purchase_price
        `;
        
        const values = [
          product.sku, 
          product.name || "", 
          product.description || "", 
          product.price || 0, 
          product.added_stock,
          product.stockUnit || "Unidad", 
          product.user_id || null, 
          product.categoria_id || null, 
          last_updated, 
          product.purchase_price || 0
        ];
        
        await db.query(query, values);
        console.log("✅ Producto procesado:", product.sku);
      }

      const deleteResult = await db.query(
        "DELETE FROM temp_productos WHERE session_id = $1", 
        [sessionId]
      );
      console.log(`✅ ${deleteResult.rowCount} productos temporales eliminados`);
      
      res.json({ 
        success: true,
        message: `Proceso de finalización completado. ${products.length} productos procesados.` 
      });
      
    } catch (err) {
      console.error("❌ Error al finalizar proceso:", err);
      res.status(500).json({ 
        error: "Error al finalizar proceso",
        message: err.message
      });
    }
  });

  return router;
};

export default createStockRouter;