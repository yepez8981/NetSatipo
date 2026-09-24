TIENDA DE INTERNET - SATIPO (Perú)
==================================
Sistema con ARQUITECTURA SEPARADA:

  1) GITHUB PAGES  -> la web (index.html). Solo frontend.
  2) APPS SCRIPT   -> el backend/API (Code.gs). Solo lógica.
  3) GOOGLE SHEETS -> la base de datos (todo el show).

Cada parte vive en su lugar y no se mezclan.

ARCHIVOS DEL REPOSITORIO (se suben a GitHub)
--------------------------------------------
- index.html    : La web completa (plana/estática): planes, contratar,
                  agendar visita, reclamos, términos legales, FAQ, etc.
- admin.html    : El panel de administración (APARTE). Misma URL de
                  backend, protegido con contraseña. No se mezcla con la
                  web pública.
- robots.txt    : Para SEO (permitir indexación).
- sitemap.xml   : Para SEO (CÁMBIALE el dominio).
- README.txt    : Estas instrucciones (no se sube si no quieres).
- Code.gs       : NO se sube a GitHub. Solo se pega en Apps Script
                  (¡contiene la contraseña del admin!).

PASO 1 - CREAR EL BACKEND (APPS SCRIPT, aparte de GitHub)
---------------------------------------------------------
1. Crea tu hoja de cálculo en Google Sheets (la base de datos).
   https://sheets.new  -> nómbrala "BD NetSatipo".
2. En esa hoja: Extensions > Apps Script.
3. Nombra el proyecto "netSatipo-api".
4. Pega en el editor TODO el contenido de Code.gs (este archivo).
5. Copia el ID de tu hoja (la parte larga de la URL entre /d/ y /edit)
   y ponlo en la línea:
       const DB = { SS_ID: 'AQUI_PEGA_EL_ID', ...
6. Guarda. Ejecuta la funcion "initDB" -> autoriza -> se crean las pestañas
   (CONFIG, PLANES, CLIENTES, SOLICITUDES, VISITAS, PAGOS, AUDITORIA),
   las claves de CONFIG y 4 planes de ejemplo.

PASO 2 - PUBLICAR EL BACKEND (Web App)
--------------------------------------
1. En Apps Script: Implementar > Nueva implementación > Aplicación web.
2. Ejecutar como: "Yo".  Acceso: "Cualquier persona" (/anónimos).
3. Autoriza y copia la URL que termina en /exec.
   (Con ese esquema Google permite llamadas desde tu web en GitHub.)

PASO 3 - PUBLICAR LA WEB EN GITHUB PAGES
----------------------------------------
1. En GitHub crea un repositorio público, p. ej. "netsatipo".
2. Sube LOS ARCHIVOS del sitio:
     - index.html
     - robots.txt
     - sitemap.xml   (cámbiale antes el dominio)
3. Ve a Settings > Pages > Source: branch "main" / carpeta "/ (root)" > Save.
4. Tu web quedará en: https://<tu-usuario>.github.io/netsatipo/
   - La web pública:     https://<tu-usuario>.github.io/netsatipo/
   - El panel admin:     https://<tu-usuario>.github.io/netsatipo/admin.html
5. (Opcional) Compra un dominio propio, p. ej. netsatipo.pe, y enlázalo en
   Settings > Pages > Custom domain.

PASO 4 - CONECTAR LA WEB CON EL BACKEND
---------------------------------------
En index.html, al inicio, está la línea:
   const GAS_EXEC = "https://script.google.com/macros/s/.../exec";
Pega ahí la URL /exec de tu backend (la del PASO 2).
Guarda y sube de nuevo a GitHub: la web ya consulta tu hoja.

PASO 5 - CONFIGURAR LA BASE DE DATOS
-------------------------------------
Abre tu hoja, pestaña CONFIG y completa:
- empresa_nombre, lema, whatsapp (+51...), telefono, correo_contacto
- direccion_oficina, horario, distritos (separados por coma)
- yape_telefono/nombre, plin_telefono/nombre, banco_nombre/cuenta/titular
- admin_pass            -> ¡CÁMBIALA!
- notify_email          -> donde recibes avisos de solicitudes/reclamos
- notify_wa_url         -> (opcional) gateway de WhatsApp para avisar al
                           cliente del cambio de estado (p. ej. tu proveedor
                           de WhatsApp Business API). Dejar vacío = sin aviso.
- notify_wa_token       -> token de ese gateway (opcional)
- tema                  -> confianza | moderno | corporativo | naturaleza
- cuota_instalacion     -> costo de instalación en S/ (se usa en la calculadora)
- estado_red            -> texto del semáforo de red (ej: "Red operativa 24/7")
- licencias             -> acreditaciones del hero (ej: "Autorizado por el MTC · OSIPTEL")
- zona_wifi_text        -> texto de Wi-Fi gratis en parques (vacío = oculto)
- promo_titulo          -> título de la promo (ej: "Primer mes a mitad de precio").
                           Vacío = banner oculto.
- promo_price           -> precio promocional en S/ (opcional)
- promo_fin             -> fecha/hora de fin de la promo en formato
                           YYYY-MM-DDTHH:MM (ej: 2026-12-31T23:59). Muestra un
                           contador de tiempo.
- razon_social, ruc, domicilio_fiscal, dpo_email (para los textos legales)
- sitio_web             -> la URL de tu GitHub Pages (para que la URL del
                           backend /exec redirija allí)
Los planes se editan en la pestaña PLANES. Las categorías de la web
("Hogar", "Empresa", "Trabajo remoto") se detectan por TEXTO en la columna
"extras": si incluye palabras como EMPRESA/NEGOCIO/OFICINA/PYME clasifica
como Empresa; REMOTO/MIXTO/TELETRABAJO como Trabajo remoto; lo demás es
Hogar. Ejemplo en extras: "Oficina · IP fija · prioritario".

DESPUÉS DE PEGAR ESTE Code.gs NUEVO: ejecuta una vez "initDB" (permisos ->
aprobarlos) para que se agreguen las claves CONFIG y la columna extra de
VISITAS sin borrar tus datos. Luego "Nueva versión" del deployment.

PASO 6 - USO Y PRUEBA
---------------------
- Tu web en GitHub muestra los planes desde Sheets.
- "Contratar plan" guarda en SOLICITUDES (estado PENDIENTE), crea/actualiza
  el cliente en CLIENTES y te llega aviso (si pones notify_email).
- "Agendar visita" SOLO permite agendar si el DNI/teléfono/correo existe en
  CLIENTES (es decir, ya tiene servicio). Guarda en VISITAS.
- Libro de Reclamaciones y Seguimiento funcionan igual que antes.
- Panel Admin: la web pública NO tiene ningún acceso al panel (ni botón,
  ni enlace, ni sección). El panel vive SOLO en admin.html
  (https://<tu-usuario>.github.io/netsatipo/admin.html), con su propia
  contraseña. Ahí gestionas solicitudes (estado), visitas (estado +
  técnico), clientes, pagos, planes y exportar CSV. La sesión se recuerda
  por navegador (localStorage) y caduca en el backend.

ACTUALIZAR DESPUÉS (importante)
-------------------------------
- Web: cada cambio en index.html se sube a GitHub (commits) y se publica
  solo. No toca el backend.
- Backend: cada cambio en Code.gs, debes actualizar la implementación:
  Implementar > Administrar implementaciones > (lápiz) > Versión: "Nueva
  versión" > Guardar. La URL /exec se mantiene igual.
- Base de datos: todo se ve en tiempo real en la hoja; no hay deploy.

MEJORAS RECOMENDADAS A FUTURO
-----------------------------
1. Pasarela de pago en línea (Izipay/Culqi) con confirmación automática.
2. Emisión de comprobantes (boleta/factura SUNAT) al confirmar pagos.
3. Recordatorios automáticos de visitas (correo/WhatsApp).
4. Zona de clientes con su facturación e historial.
5. Mapa de cobertura por distritos.
6. Inventario de equipos (routers/ONU) y stock en otra pestaña.
7. Reportes mensuales automáticos por correo.
8. Agenda de técnicos por distrito y asignación de visitas.

NA - Aviso legal
---------------
Como operador de telecomunicaciones debes operar con RUC propio y bajo la
concesión/autorización de MTC/OSIPTEL que corresponda. Un abogado debe
validar el contrato final y el formato del Libro de Reclamaciones del
Establecimiento (el de la web cubre la parte en línea).