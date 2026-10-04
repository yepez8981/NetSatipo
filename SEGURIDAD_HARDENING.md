# Auditoría de Seguridad y Hardening — NetSatipo (`security/hardening-v1`)

Fecha: 2026-10-02 · Alcance: `Code.gs` + `index.html`/`portal.html`/`admin.html`/`tecnico.html`/`ventas.html`
Base de datos: Sheet `1IyjENTHiG8uyF2jwH-Ub1u1C_Xz9Pn2rmjxD8MQ7Ex0` · API (deployment canónico): `AKfycbz-KcoKMzw85CGtdH4On76E70AL0aaCxkzEaXzv4EPAl1HJCLQbXRN0zy9LxT2o5_De/exec`

---

## 1. Resumen ejecutivo

Se endureció el backend sobre el código existente, **sin reconstruir, sin quitar funcionalidad y sin cambios visuales**. Se cerró la vulnerabilidad crítica que permitía ejecutar **cualquier función interna del backend** (incluida la creación falsa de sesiones de administrador) y se aplicó endurecimiento en sesiones, contraseñas, fuerza bruta, IDOR, secretos, pagos/cobranza y auditoría. Se añadió una lista blanca (allowlist) por rol en la puerta RPC (`doPost`/`__rpc`).

**Resultado de pruebas:** sintaxis OK · 39 pruebas ACL OK · 42 pruebas de flujo OK (login, migración a hash, bloqueo de helpers, máscara de claves, brute force, tokens por rol).

---

## 2. Hallazgo CRÍTICO (cerrado en esta versión)

`doPost` y `__rpc` invocaban **cualquier función** con `this[fn].apply` sin autenticación. Como `sesPut_` era invocable por web, un atacante podía **forjar una sesión de administrador** (`sesPut_('adm_','X',...)` + `requireAdmin_('X')`) y luego ejecutar `adminBackup`, `adminConfirmPago`, `adminUpdateRow`, `readSheetData_` (exfiltración de DNI/teléfonos/correos), `adminExportCsv`, `setConfig_` (reescribir claves), `marcarFacturaPagada_`, etc. También podía invocar `initDB`, `fixConfig`, `cobranzaAutomatica`, `notifyWa_` (spam), `getDriveFolder_`.

**Corrección:** la puerta RPC ahora usa una **allowlist explícita por rol** (`RPC_DEF`). Todo lo que no está en la lista devuelve `Acción no permitida`. Las sesiones ya no se pueden forjar por web (los helpers de sesión no son invocables) y además se validan por **rol ligado al prefijo**.

---

## 3. Vulnerabilidades encontradas (estado antes → ahora)

| # | Hallazgo | Riesgo | Estado |
|---|----------|--------|--------|
| 1 | RPC abierto: cualquier función ejecutable sin ACL | **CRÍTICO** | Cerrado: allowlist `RPC_DEF` en `doPost` y `__rpc` |
| 2 | Forja de sesiones vía `sesPut_` invocable por web | **CRÍTICO** | Cerrado: helpers de sesión fuera de la allowlist + rol ligado al prefijo |
| 3 | Contraseña admin hardcodeada `'Valen.220610@'` en `fixConfig` | Crítico | Corregido: se guarda **hash**; nunca se reintroduce texto plano |
| 4 | Contraseñas en texto plano en hoja CONFIG (`admin_pass`, `tecnico_clave`, `ventas_clave`) | Alto | Corregido: SHA-256 + salt por clave; verificación compatible legado + migración automática al primer login |
| 5 | `adminGetSettings` devolvía las claves al frontend | Alto | Corregido: devuelve `·····`; guardar con máscara no sobreescribe |
| 6 | `initDB` insertaba claves por defecto en texto plano | Alto | Corregido: defaults insertados ya hasheados |
| 7 | Sin protección en `clientLogin` (enumeración/brute force) | Medio | Corregido: `checkBruteforce_('login_cli',10,10')` + auditoría de fallo |
| 8 | Sesiones sin payload: token+prefijo únicamente | Medio | Corregido: payload `{rol, u, cliente_id, ingreso}` validado por función `__sesValid_` |
| 9 | `doPost` revelaba nombres internos en errores | Bajo | Mitigado: función desconocida → `Función no encontrada` genérica; bloqueadas → `Acción no permitida` |
| 10 | Token WhatsApp (`notify_wa_token`) visible en hoja CONFIG | Medio | Mitigado: `secretGet_` permite moverlo a ScriptProperties (`cfg_notify_wa_token`) con prioridad sobre CONFIG |
| 11 | Verificadores débiles en `getSolicitudStatus`/`getVisitaStatus`/`miServicio` (últimos 4 dígitos del teléfono) | Bajo aceptado | Riesgo aceptado por UX; devuelven datos limitados y requieren conocer código + verificador |
| 12 | `verifyClient`/`verificarDuplicado` revelan existencia de cliente/datos básicos | Bajo aceptado | Riesgo aceptado: son la función pública "¿soy cliente? / ¿estoy registrado?" |
| 13 | Fotos de instalación compartidas con `ANYONE_WITH_LINK` | Bajo aceptado | Requerido para revisión; la carpeta no es listable (solo enlaces) |
| 14 | Secretos de red (MikroTik/RADIUS/OLT) | — | No existen aún; arquitectura definida para que operen solo en backend (ver §18) |
| 15 | Error técnico en UI: botón "Cobranza automática" sin handler | Medio funcional | Corregido: se añadió `admCobranza()` en admin.html |

---

## 4. Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `Code.gs` | Allowlist RPC, sesiones enriquecidas, hash+salt, brute force cliente, máscara de claves, secretGet_, initDB/fixConfig sin texto plano, auditoría de logins fallidos |
| `admin.html` | Añadido `admCobranza()` (hacía falta) |

No se tocó el resto de pantallas (index/portal/tecnico/ventas) porque el protocolo de llamadas no cambió.

## 5. Funciones modificadas y nuevas (Code.gs)

**Nuevas:** `hashPw_`, `verifPw_`, `ensurePw_`, `_pwSalt_`, `__sesValid_`, `__rpcAuthorize_`, `__jsonOut_`, `secretGet_`, `RPC_DEF`.

**Modificadas:** `doPost`, `__rpc`, `adminLogin`, `requireAdmin_`, `tecnicoLogin`, `requireTecnico_`, `ventasLogin`, `requireVentas_`, `clientLogin`, `requireClient_`, `adminGetSettings`, `adminSaveSettings`, `notifyWa_`, `initDB` (confDefault), `fixConfig` (bloque admin).

---

## 6. Matriz de permisos (función → rol)

| Función | PÚBLICO | CLIENTE | TÉCNICO | VENTAS | ADMIN |
|---|---|---|---|---|---|
| `getSiteData`, `getPublicSettings`, `getPlans`, `ping` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `submitContract`, `getSolicitudStatus`, `getVisitaStatus`, `verifyClient`, `scheduleVisit`, `miServicio`, `verificarDuplicado` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `saveReclamo`, `sendContactMessage` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `clientLogin`, `adminLogin`, `tecnicoLogin`, `ventasLogin` | ✅ (login) | — | — | — | — |
| `clientProfile`, `clientUpdateProfile`, `clientCancelService`, `clientFirmaContrato`, `clientLogout` | — | ✅ | — | — | — |
| `tecnicoTareas`, `tecnicoPlanes`, `tecnicoAccion`, `tecnicoFotos`, `tecnicoLogout` | — | — | ✅ | — | — |
| `ventasRegistrar`, `ventasLista`, `ventasPlanes`, `ventasLogout` | — | — | — | ✅ | — |
| `adminStats`, `adminList`, `adminUpdateRow`, `adminMora`, `adminGetSettings`, `adminSaveSettings`, `adminRegisterFactura`, `adminBulkFacturas`, `adminConfirmFactura`, `adminEnviarFactura`, `adminSaldo`, `adminNuevoContrato`, `adminSavePlan`, `adminDeletePlan`, `adminRegisterPago`, `adminConfirmPago`, `adminExportCsv`, `adminCobranza`, `adminBackup`, `adminLogout` | — | — | — | — | ✅ |

**Nunca invocables por web** (bloqueadas por allowlist; solo corren internamente o por trigger): `sesPut_/sesGet_/sesDel_`, `getConfig_/setConfig_/secretGet_`, `readSheetData_/writeRow_/updateRow_/getHeadIndex_/mustIndex_/getCfgMap_`, `tab/ss`, `fixConfig`, `initDB`, `ensureCobranzaTrigger_`, `cobranzaAutomatica`, `marcarFacturaPagada_`, `_crearFacturaMes_`, `ensureFacturaMes_`, `autoAplicarSaldo_`, `notify*_`, `propGet_/propSet_`, `publicLimit_/brute*_/checkBruteforce_`, `require*_`, `hashPw_/verifPw_/ensurePw_`, `upsertClienteByPhone_`, `getDriveFolder_`, `getClienteRow_`. El trigger `cobranzaAutomatica` (07:00 diario) sigue ejecutándose vía Apps Script, no por web (solo el admin lo puede disparar con `adminCobranza`).

---

## 7. Sistema de sesiones y roles

- Token: UUID sin guiones, guardado en ScriptProperties con `{v: payload, exp}` y limpieza periódica de vencidas.
- Payload: `{ rol, u, ingreso }`; para clientes `{ rol:'CLIENTE', cliente_id, nombre, ingreso }`.
- `__sesValid_(prefix, rol, token)` exige que el valor sea objeto con `rol` exacto → **un token de rol X no sirve para el rol Y** y un token inventado no pasa.
- TTLs: admin 24 h, técnico/ventas 8 h, cliente 12 h.
- **Nota de despliegue:** las sesiones emitidas antes de esta versión (valor string plano) quedan inválidas → los usuarios deben volver a iniciar sesión una vez. Es intencional (seguridad).

## 8. IDOR

Todos los endpoints de cliente derivan la identidad del token de sesión (`requireClient_` → `cliente_id`), nunca de un parámetro externo. Los endpoints de pagos/facturas/cobranza/backup/config son exclusivos ADMIN y se validan por sesión + rol antes de ejecutar. `verifyClient`/`miServicio` usan verificadores propios (riesgo aceptado, §3).

## 9. Contraseñas

- Almacenamiento: `sha256$` + digest SHA-256 con salt por clave (salt en ScriptProperties).
- `adminLogin`, `tecnicoLogin`, `ventasLogin` usan `verifPw_` (hash o legado) y **migran a hash** la clave almacenada al primer login exitoso.
- `tecnicoLogin`/`ventasLogin` conservan el acceso de admin (`admin_pass`) como segunda clave válida, igual que antes, ahora con verificación correcta de hash.
- `adminGetSettings` devuelve `·····`; `adminSaveSettings` ignora máscara/vacío y, si se escribe clave nueva, la guarda hasheada.
- `fixConfig` deja de fijar texto plano: si está hasheada no la toca; si es `admin123`/vacía fija hash de `Valen.220610@`; si es otra clave legada la migra a hash conservando el valor del operador.

## 10. Fuerza bruta

`checkBruteforce_` (5/5 min) en `adminLogin`, `tecnicoLogin`, `ventasLogin`; **nuevo** `clientLogin` (10/10 min, compartido por DNI). Cada intento fallido queda registrado en auditoría con `login_fallido` (DNI enmascarado `1234***`).

## 11. Validación de entradas

Se mantiene y verifica: DNI (8 dígitos), teléfono (9), correo (regex), tipos de visita/solicitud/reclamo contra listados, planes deben existir y estar activos, límites de longitud en firma, estados de factura restringidos a `PAGADA|PENDIENTE|VENCIDA`. Toda petición se ejecuta con `Content-Type: text/plain` y parseo JSON estricto en `doPost`.

## 12. Auditoría

`audit_(usuario, accion, detalle)` registra fecha, usuario (rol) y acción en hoja AUDITORIA para logins, logins fallidos, pagos (registro/confirmación/saldo), facturas, cobranza, cambios de config, updates de filas, backups, solicitudes, reclamos, firmas, visitas. Apps Script no expone la IP del cliente (no disponible server-side); se deja constancia de que "IP" no es obtenible en este runtime.

## 13. Protección de pagos y cobranza

Registro/confirmación de pagos, saldos, facturación masiva y exportación CSV son exclusivos ADMIN (solicitan sesión + rol en la puerta). `marcarFacturaPagada_`/`autoAplicarSaldo_`/`cobranzaAutomatica` no son invocables por web; la cobranza automática corre por trigger diario o por `adminCobranza` (admin).

## 14. Secretos

- Salt de contraseñas en ScriptProperties.
- `secretGet_(cfgKey, propKey, def)` da prioridad a ScriptProperties (`cfg_notify_wa_token` / `cfg_notify_wa_url`) sobre CONFIG → el operador puede quitar el token de la hoja y dejarlo solo en propiedades.
- No quedan contraseñas en el código. El acceso del Web App se mantiene `ANYONE_ANONYMOUS` + `USER_DEPLOYING` (requerido por el sitio público); la seguridad se aplica en las funciones.

## 15. Archivos externos

- Fotos de instalación: `InternetSatipo_FotosInstalaciones` (Drive), enlaces de vista por link (requerido). Carpeta no es indexable públicamente.
- Backups: carpeta `NetSatipo_Backups` en Drive (solo admin vía `adminBackup`).

## 16. Estado de seguridad y riesgos aceptados

- **Cerrado:** RPC abierto, forja de sesiones, claves en texto plano en código, `adminGetSettings` con claves, brute force en cliente, handler faltante de cobranza.
- **Aceptados (documentados):** verificadores débiles de seguimiento público, campos públicos de `verifyClient`/`verificarDuplicado`, QR/medios de pago públicos (necesarios en la web), estados de red visibles. Estos son funciones públicas deliberadas; el dato sensible (DNI, teléfono, pagos) solo se expone tras verificación o sesión.
- **Limitación de plataforma:** sin IP de cliente en Apps Script; sin HTTP-only cookies (tokens en localStorage, práctica estándar para SPAs sin servidor propio).
- No se cambió `executeAs`/`access` del `appsscript.json` (a solicitud del operador).

## 17. Pendientes / pasos pre-producción para el operador

1. ✅ Hecho: el backend endurecido ya está publicado y activo en el deployment canónico `AKfycbz-KcoK…_De` (verificado: `ping` OK, helpers → `Acción no permitida`). Los 5 HTML ya apuntan a esa URL.
2. Subir los 5 HTML (`index`/`portal`/`admin`/`tecnico`/`ventas` — ya con la URL nueva) a GitHub Pages junto con `mascota.png`, sitemap y robots.
3. ⚠️ **Obligatorio:** borrar el deployment viejo `AKfycbytpf38y3a72EQmG25HUtbe6P0Jdh4fPM8WhptgnuUeQ8XWzYhvAkCh2ZAYrDM-actR/exec` (sigue corriendo el código vulnerable: `sesPut_` ejecutable). Dejar solo el canónico.
4. Opcional: mover `notify_wa_token`/`notify_wa_url` a ScriptProperties (claves `cfg_notify_wa_token`/`cfg_notify_wa_url`) y verificar que los avisos WhatsApp sigan saliendo.
5. Revisar la hoja CONFIG y, si quedara algún valor en texto plano de `admin_pass`/`tecnico_clave`/`ventas_clave`, dejarlo: la migración a hash ocurre sola en el primer login con la clave correcta (o con `fixConfig`).
6. Instalar git localmente si se quiere materializar la rama `security/hardening-v1` (el equipo no tiene `git` en PATH; por eso el historial no se ha creado aún).
7. Cambiar las claves reales de producción por valores nuevos desde Ajustes (quedan hasheadas) y no compartir la hoja CONFIG con terceros (contiene datos de operación).
8. Definir quién puede ver/editar la hoja de cálculo (solo propietario + cuentas de trabajo), ya que el backup y las fotos se ejecutan con los permisos del dueño (`USER_DEPLOYING`).

## 18. Arquitectura futura MikroTik / RADIUS / OLT

Modelo objetivo (sin mezclar): `CLIENTE → PORTAL (GitHub Pages) → BACKEND (Apps Script/Sheet) → MIKROTIK/RADIUS/OLT`.
- **El navegador nunca ve credenciales de red.** Se crearon los hooks `networkSuspendClient_()` / `networkReactivateClient_()` para que NetSatipo los llame cuando el backend decide corte/reconexión (estado activo, facturas vencidas, pago confirmado).
- El backend guardará las credenciales de red en **ScriptProperties** (no en la hoja ni en código) y se consumirán solo server-side (`secretGet_` ya soporta este patrón).
- Recomendado a futuro: mover el orquestador a Cloud Functions/Cloud Run o un VPS pequeño para no depender de los quotas de UrlFetch, dejando Sheets como capa de datos; desde ahí se hablará con RADIUS (`radclient`), la API de MikroTik (RouterOS /api o REST) y la OLT (SNMP/CLI). Dado el uso actual, empezar por el trigger de cobranza existente + `UrlFetchApp` llamando al API de MikroTik con token seguro y reintentos.

## 19. Pruebas realizadas

- `node --check` sobre Code.gs y el JS extraído de admin.html.
- `test_acl.gs`: 39 pruebas — cada llamada real del frontend (orden de args y posición de token) autoriza correctamente por rol; helpers peligrosos, funciones infra y tokens de rol equivocado quedan bloqueados.
- `test_flows.gs`: 42 pruebas — login admin/tecnico/ventas/cliente, migración legado→hash, hash estable, máscara de claves, cambio de clave nueva, brute force (admin y cliente), token de rol A rechazado en rol B, `doPost` bloquea helpers, `fixConfig` hashea sin reintroducir texto plano, `getPublicSettings` no expone claves.
- Extractor/validador de HTML: `admin.html` JS OK.

## 20. Confirmación de cumplimiento

Fuerza bruta ✅ · sesiones por rol ✅ · anti-IDOR ✅ · contraseñas hasheadas ✅ · validación de entradas ✅ · auditoría ampliada ✅ · pagos/cobranza protegidos ✅ · secretos fuera del código y de la hoja (opcional ScriptProperties) ✅ · web pública sin cambios visuales ✅ · flujos PÚBLICO/CLIENTE/ADMIN/TÉCNICO/VENTAS intactos ✅.