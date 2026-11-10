# PRD — Pi Agents Profile Cycler v2

**Estado:** Propuesta original (histórico); implementada en v2, estado actual en §0  
**Fecha:** 2026-11-09  
**Tipo:** Extensión global de Pi para el runtime `mavam/pi-agents`  
**Base de trabajo:** Archivos extraídos de `pi-profile-cycler-v1-20261109.zip` (`pi-profile-cycler.ts`, `profile-cycler.json`, `README.md`, `test-local.cjs`).  
**Nombre de trabajo del repositorio:** `pi-agents-profile-cycler`

## 0. Estado actual y actualizaciones

**Estado al 2026-11-10:** la v2 está implementada en este repositorio. El texto original de este documento se conserva como historia del dueño. Donde una afirmación ya no vale, está marcada inline como *superada* y remite a esta sección. El comportamiento vigente está en los documentos canónicos:

- [Arquitectura](architecture.md): módulos, precedencia, transacción de activación y editor.
- [Compatibilidad y límites](compatibility.md): revisiones inspeccionadas, contratos de Pi y mavam, delegación anidada.
- [README](../README.md): instalación, uso y comandos.
- [ExecPlans completados](exec-plans/completed/), en particular [`hprofile-manage.md`](exec-plans/completed/hprofile-manage.md).
- [Deuda técnica](exec-plans/tech-debt-tracker.md) y [checklist manual](manual-testing.md).

Versiones verificadas: Pi 1.5.x y `mavam/pi-agents` 0.39.0 (ver compatibility.md).

### Cambios respecto del texto original

| Fecha | Cambio | Texto original afectado |
|---|---|---|
| 2026-11-09 | El atajo es **Alt+M**. Pi 1.5.0 reserva **Alt+P** en Windows para "modelo anterior" (`app.model.cycleBackward`) y omite los atajos de extensiones sobre esa tecla. | `Alt+P` en §1, RF-01, §6.3, §10 (Fase 2) y §11. |
| 2026-11-09 | El prefijo de proveedor es `openai/` (p. ej. `openai/gpt-6.1-sol`), no `openai-codex/`. | IDs de modelo de §4 y §6.1. |
| 2026-11-09 | Política de precedencia **explicit-wins**: un `model`/`thinking` explícito en `agent_spawn` gana por campo y el perfil completa lo omitido. | `profile-wins` en RF-04, §8, §10 y §11. |
| 2026-11-10 | Un `model` explícito sin `thinking` explícito no recibe thinking inyectado; mavam lo resuelve (commit `a8b6767`). | Complementa explicit-wins; no figura en el original. |
| 2026-11-10 | Perfiles: `main` y `agents` son opcionales; `agents` admite cualquier nombre de rol; `default` cubre al orquestador si falta `main` y a todo subagente sin ruta propia; todo perfil requiere `main` o `default`. Prioridad: explícito → rol → `default` → nativo de mavam. `manage` es nombre reservado. | Matriz obligatoria de siete roles en §4, §6.1, §8 y §11; RF-06. |
| 2026-11-10 | `/hprofile manage`: editor dentro de Pi (crear, editar, borrar, activar y definir perfil por defecto), selector de modelos con búsqueda difusa y descubrimiento, solo lectura, de agentes de usuario y de proyecto confiable. | RF-02 (lista de comandos). |
| 2026-11-10 | Escritura: `manage` escribe únicamente `profile-cycler.json` (con `.bak`, atómico y validado). Las rutas se guardan al confirmar *Guardar*; borrar o definir el default requiere confirmación. **Los Markdown de agentes nunca se escriben.** | Reglas de "sin escritura" en RF-05, §7, §8 y §10 (Fase 1). |
| 2026-11-10 | Licencia **MIT**, © 2026 Nahuel Nicolas Noir (nanonoir). | Licencia pendiente en §10 (Fase 0). |
| 2026-11-10 | Smoke manual del dueño en Pi: `manage`, selector difuso, creación y edición de perfiles, y Alt+M funcionaron. | Verificación pendiente de §8 y §11. |

### Límites vigentes

- **Delegación anidada no soportada:** los helpers creados por un subagente (`spawn: true`) no reciben el routing de perfil. El hook de Pi cubre solo el `agent_spawn` directo del orquestador. Sin un hook estable de mavam no se declara soporte (§6.4; [compatibility.md](compatibility.md); TD-004).
- **Pendiente de verificación real:** un spawn autenticado con un perfil que solo define `default` (TD-002).
- **Escritura entre ventanas:** la comparación antes de escribir en `manage` no es atómica entre procesos (TD-003).
- Sin cambios respecto del original: no hay fallback por cuota, no se editan los `.md` de los agentes y no se tocan `settings.json`, `auth.json`, MCP ni `context-prune`.

## 1. Resumen ejecutivo

Evolucionar el selector experimental v1 a una extensión pequeña, predecible y mantenible de Pi que permita alternar **en la misma sesión** entre tres perfiles de asignación de modelos: **`balanced`**, **`claude`** y **`codex`**. Una pulsación de **`Alt+P`** *(superado: atajo actual **Alt+M**, §0)* debe activar el siguiente perfil y actualizar el modelo/thinking del orquestador y el routing de **las próximas delegaciones** de `pi-agents`.

La v2 debe **conservar `pi-agents`**, no editar los `.md` de los agentes, no compartir accidentalmente el estado activo entre ventanas o sesiones y no tocar credenciales, permisos, MCP, compaction o pruning. Los agentes ya creados mantienen su identidad/modelo; el nuevo perfil aplica a los **agentes nuevos**, incluso si Pi fue iniciado antes del cambio.

El selector administrará **rutas de modelos**, no actuará como proveedor, bridge, orquestador, sistema de permisos ni mecanismo de fallback de cuota.

## 2. Contexto y hallazgos de la v1

El ZIP inicial contiene cuatro archivos y no es todavía un paquete publicable. La implementación `pi-profile-cycler.ts`:

- Registra `Alt+P` y `/hprofile`.
- Usa `pi.setModel()` y `pi.setThinkingLevel()` para el modelo principal.
- Escribe las claves `model` y `thinking` directamente en `~/.pi/agent/agents/*.md`.
- Almacena `active` en un JSON **global** compartido por todas las sesiones.
- Relee el JSON al activar el perfil y valida que los IDs estén registrados.
- Conserva las instrucciones de los Markdown, pero no aísla las escrituras entre ventanas.

**Problemas a resolver:** mutaciones globales, colisiones entre sesiones, restauración global que pisa la selección específica de una sesión, falta de integración con delegaciones ad hoc y anidadas, falta de pruebas de integración reales y un mapeo histórico confuso: `codex-low` contenía mayormente Claude y `claude-low` contenía mayormente Codex. **La migración debe mapear por contenido, no renombrar a ciegas.**

### Evidencia técnica relevante

- `pi-agents` descubre los perfiles Markdown globales y de proyecto mediante `discoverProfiles()` y resuelve los atributos de un spawn en el momento de crearlo.
- En `resolveSpawn`, el orden observado es: `request.model` → `profile.model` → modelo de la sesión; para thinking: `request.thinking` → `profile.thinking` → valor heredado.
- `agent_spawn` recibe `{ agents: [{ profile?, name?, job, model?, thinking?, ... }] }` y resuelve cada agente antes de iniciar el grafo. Por eso una extensión Pi puede **inyectar `model`/`thinking` antes de ejecutar esa herramienta** mediante el hook `tool_call`.
- Pi ofrece `pi.registerShortcut`, `pi.registerCommand`, `pi.setModel`, `pi.setThinkingLevel`, `pi.appendEntry` y `ctx.sessionManager.getBranch()` para operar y persistir estado de sesión.
- **Limitación conocida:** los helpers creados por un subagente pueden usar una ruta interna distinta de `agent_spawn` del padre. No afirmar que heredan dinámicamente el perfil hasta demostrarlo o integrar un hook oficial de mavam.

Fuentes: [mavam/pi-agents — profiles](https://github.com/mavam/pi-agents/blob/main/src/catalog/profiles.ts), [mavam/pi-agents — spawn](https://github.com/mavam/pi-agents/blob/main/src/pi/spawn.ts), [mavam/pi-agents — tools](https://github.com/mavam/pi-agents/blob/main/src/pi/tools.ts), [Pi — extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md).

## 3. Objetivos y criterios de éxito

1. Cambiar de perfil con **un atajo** (`Alt+P`, superado: **Alt+M**, §0) o `/hprofile <nombre>`, sin reiniciar Pi ni perder el contexto.
2. Seleccionar inmediatamente el modelo y thinking del **orquestador**, a partir de la próxima solicitud segura; no interrumpir respuestas en curso.
3. Hacer que los **nuevos agentes delegados directamente por el orquestador** usen el modelo/thinking definido para su rol en el perfil activo, independientemente del momento en que comenzó la sesión.
4. Mantener la configuración activa **por sesión**, no por archivo global mutable.
5. Preservar íntegramente `agents/*.md`, instrucciones, herramientas, habilidades y demás configuración del harness.
6. Usar un **único JSON editable** para definir, ordenar y modificar perfiles.
7. Fallar con explicación clara ante modelos no registrados, JSON inválido o extensiones incompatibles; no aplicar rutas equivocadas ni activar silenciosamente otro proveedor.
8. Poder instalar, probar, versionar y publicar el proyecto sin depender de scripts PowerShell de activación.

## 4. Perfiles iniciales aprobados

Los nombres **deben ser exactamente** `balanced`, `claude` y `codex`. Semántica: `claude` prioriza Claude; `codex` prioriza OpenAI Codex; `balanced` combina ambos. No equivalen a "cuota baja". Modelos previstos sujetos a comprobación con `pi --list-models`.

| Rol | `balanced` | `claude` | `codex` |
|---|---|---|---|
| Orchestrator | Sol 6.1 · medium | Opus 5.5 · medium | Sol 6.1 · low |
| specs-writer | Terra 6.1 · high | Sonnet 5.5 · medium | Terra 6.1 · high |
| designer | Sol 6.1 · medium | Opus 5.5 · medium | Sol 6.1 · medium |
| implementer | Sonnet 5.5 · medium | Sonnet 5.5 · medium | Terra 6.1 · medium |
| fix-agent | Sonnet 5.5 · medium | Sonnet 5.5 · medium | Terra 6.1 · medium |
| reviewer | Gemini Flash 3.8 · high | Gemini Flash 3.8 · high | Gemini Flash 3.8 · high |
| explorer | Gemini Flash 3.8 · high | Gemini Flash 3.8 · high | Gemini Flash 3.8 · high |
| archiver | Gemini Flash 3.8 · high | Gemini Flash 3.8 · high | Gemini Flash 3.8 · high |

IDs orientativos (no inventar alias si no están registrados):

- Sol: `openai/gpt-6.1-sol`
- Terra: `openai/gpt-6.1-terra`
- Opus: `claude-code/claude-opus-5-5`
- Sonnet: `claude-code/claude-sonnet-5-5`
- Flash: `antigravity/gemini-3-8-flash`

`reviewer`, `explorer` y `archiver` deben declararse en cada perfil o mediante una sección compartida **con resolución determinista**: todos se asignan explícitamente como Gemini High. Un posible agente `teacher` preexistente no debe alterarse si no se incluye expresamente. *(Superado 2026-11-10: los siete roles estándar ya no son obligatorios; ver §0.)*

## 5. Requisitos funcionales

### RF-01 — Selector rápido

- `Alt+P` *(superado: **Alt+M**, §0)* recorre `balanced → claude → codex → balanced`, usando el orden configurable del JSON.
- Un cambio exitoso muestra una notificación breve y el perfil activo en la barra de estado.
- El atajo no abre un menú ni pide confirmación en el flujo normal.
- `Tab` queda intacta para el autocompletado de Pi.

### RF-02 — Comandos

- `/hprofile`: abre un selector TUI.
- `/hprofile <nombre>`: activa un perfil específico.
- `/hprofile next`: siguiente perfil.
- `/hprofile status`: muestra perfil y matriz efectiva de rutas, el modelo real del orquestador, y advierte rutas no aplicables.
- `/hprofile reload`: relee el JSON de perfiles y valida su contenido sin reiniciar Pi. **No cambia el perfil activo** salvo que el seleccionado ya no exista; en ese caso informar y pedir elección o aplicar explícitamente el default documentado.
- `/hprofile manage` *(añadido 2026-11-10)*: editor dentro de Pi para crear, editar, borrar, activar y definir el perfil por defecto, con selector de modelos difuso. Ver §0.
- No añadir comandos que nunca puedan ejecutarse; pruebas para todos los comandos publicados.

### RF-03 — Routing del orquestador

- Resolver `provider/modelId` mediante el registro de modelos de Pi.
- Antes de confirmar un cambio, validar modelo principal y thinking soportado.
- Ejecutar `pi.setModel()` y `pi.setThinkingLevel()` en la sesión actual.
- No editar `settings.json` global para activar un perfil. Pi registrará el cambio del modelo en el historial de la sesión mediante sus APIs.
- Una generación ya iniciada no se interrumpe ni se redirige a mitad de stream. Si el cambio se solicita mientras Pi está ocupado, aplicarlo en el siguiente límite seguro o avisar claramente que quedó pendiente.

### RF-04 — Routing de nuevos subagentes de `pi-agents`

- Interceptar **exclusivamente** llamadas a la herramienta `agent_spawn` en `tool_call`.
- Para cada entrada de `agents[]`, identificar rol por `agent.profile` primero; como compatibilidad opcional, usar `agent.name` **solo cuando coincida exactamente con un rol configurado**.
- Inyectar `agent.model` y `agent.thinking` conforme al perfil activo en el **momento de ejecutar el spawn**.
- No modificar `job`, `name`, `profile`, `after`, `cwd`, `tools`, `skills`, `spawn`, `failFast` ni demás campos.
- Un agente sin coincidencia de rol conserva el comportamiento nativo de mavam; no imponerle una ruta aleatoria.
- **Actualización 2026-11-09 (decisión del dueño):** la política vigente es **`explicit-wins`**: un `model`/`thinking` explícito en el `agent_spawn` se respeta y el perfil solo completa los campos omitidos. Desde 2026-11-10, un `model` explícito sin `thinking` explícito no recibe thinking inyectado (ver §0). Texto original, histórico:
- En roles configurados, la política inicial es **`profile-wins`**: los valores explícitos de modelo/thinking enviados por el LLM se sustituyen por los del perfil. Dejar esta regla visible en documentación y pruebas. Una política `respect-explicit` podrá estudiarse después, pero no es requisito del MVP.
- La inyección debe validar antes del spawn, sin introducir nuevas llamadas de modelo.

### RF-05 — Identidad y persistencia de sesión

- `defaultProfile` en el JSON es un **valor de inicio**; no existe un `active` global que gobierne todas las ventanas.
- Guardar cada selección como entrada personalizada de sesión (`pi.appendEntry`), nunca en archivos compartidos de agentes.
- En `session_start`, recuperar la última selección alcanzable de la **rama activa** del historial (usar APIs de sesión correspondientes), no simplemente el último cambio de todas las ramas.
- Sesiones A y B, abiertas a la vez, pueden usar perfiles diferentes sin afectarse.
- Documentar comportamientos para nueva sesión, `/resume`, `/tree`, `/fork`, `/reload` y cambio manual con `/model`. Al navegar entre ramas, reconciliar el perfil con la rama activa o indicar explícitamente la política adoptada; **no mostrar un estado falso**.
- No regenerar entradas de sesión redundantes al restaurar estado.

### RF-06 — Configuración simple

- Un único archivo de configuración de usuario, p. ej. `~/.pi/agent/profile-cycler.json`.
- Schema con `version`, `defaultProfile`, `order`, `profiles` y `main`/`agents`. Sin `active` mutable compartido. *(Actualizado 2026-11-10: `main` y `agents` opcionales, `default` por perfil, `agents` con cualquier nombre de rol y `manage` reservado; ver §0.)*
- Configurable sin recompilar. Los cambios se aplican mediante `/hprofile reload`.
- Validar JSON, nombres duplicados, orden, roles, modelo no vacío, ID `provider/model`, thinking permitido, datos inesperados y valores faltantes. Error legible indicando el campo exacto.
- Permitir agregar perfiles adicionales en el futuro, sin asumir que siempre habrá tres; el ejemplo inicial incluye solo los tres aprobados.
- Todas las rutas declaradas deben estar disponibles para el perfil antes de aplicarlo. No hacer fallback automático ante 429/agotamiento de cuota.

### RF-07 — Estado y observabilidad

- Barra de estado compacta: `profile: balanced`.
- `/hprofile status` distingue claramente **perfil seleccionado**, **modelo efectivo del padre**, **rutas configuradas para próximos spawns** y **agentes ya activos que conservan su ruta**.
- No afirmar que los modelos cambiaron si `pi.setModel` falló o el preflight rechazó la operación.
- Sin telemetría, red, jobs periódicos, lecturas de tokens de sesión ni datos personales en logs.

### RF-08 — Compatibilidad y límites

- Solo `mavam/pi-agents` es el runtime objetivo. No instalar `pi-subagents`, `pi-multi-profiles` ni un segundo motor.
- Extensión global de Pi, orientada primero a Windows/PowerShell, sin código que dependa exclusivamente de Windows.
- Respetar perfiles `.pi/agents` del proyecto: sus **instrucciones y herramientas** siguen siendo propiedad del proyecto; el selector solo inyecta `model`/`thinking` para roles conocidos en un `agent_spawn` directo.
- El plugin **no es un guard de permisos** de shell/Git/secretos, ni de las herramientas nativas del ACP Antigravity.
- No cambiar `context-prune/settings.json` (el usuario mantiene `on-demand`, Gemini Flash Medium), MCP, `auth.json`, bridges o `AGENTS.md`.

## 6. Contratos y diseño propuesto

### 6.1 Esquema de configuración de ejemplo

```json
{
  "version": 2,
  "defaultProfile": "balanced",
  "order": ["balanced", "claude", "codex"],
  "profiles": {
    "balanced": {
      "main": { "model": "openai/gpt-6.1-sol", "thinking": "medium" },
      "agents": {
        "specs-writer": { "model": "openai/gpt-6.1-terra", "thinking": "high" },
        "designer": { "model": "openai/gpt-6.1-sol", "thinking": "medium" },
        "implementer": { "model": "claude-code/claude-sonnet-5-5", "thinking": "medium" },
        "fix-agent": { "model": "claude-code/claude-sonnet-5-5", "thinking": "medium" },
        "reviewer": { "model": "antigravity/gemini-3-8-flash", "thinking": "high" },
        "explorer": { "model": "antigravity/gemini-3-8-flash", "thinking": "high" },
        "archiver": { "model": "antigravity/gemini-3-8-flash", "thinking": "high" }
      }
    },
    "claude": { "main": { "model": "claude-code/claude-opus-5-5", "thinking": "medium" }, "agents": {} },
    "codex": { "main": { "model": "openai/gpt-6.1-sol", "thinking": "low" }, "agents": {} }
  }
}
```

**Atención:** los `agents: {}` de `claude` y `codex` son **abreviaturas explicativas, no el archivo final**. El archivo distribuido debe declarar la matriz completa de la sección 4. La validación debe fallar o avisar inequívocamente si faltan roles obligatorios; no introducir fallback implícito. *(Superado 2026-11-10: no hay roles obligatorios; ver §0.)*

### 6.2 Paquetes y módulos propuestos

```text
pi-agents-profile-cycler/
├── src/
│   ├── index.ts                  # Registro del extension API
│   ├── config.ts                 # Carga, schema y validación
│   ├── state.ts                  # Selección por sesión y restauración
│   ├── routing.ts                # Función pura: agent_spawn + perfil → nueva entrada
│   ├── switching.ts              # Preflight y aplicación del modelo principal
│   └── ui.ts                     # Comandos, atajo y status
├── examples/
│   └── profile-cycler.json       # Tres perfiles completos
├── tests/
│   ├── config.test.ts
│   ├── routing.test.ts
│   ├── state.test.ts
│   └── switching.test.ts
├── docs/
│   ├── architecture.md
│   └── limitations.md
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE
└── .gitignore
```

Mantener el proyecto pequeño: consolidar archivos si la separación agrega complejidad sin beneficio. Usar funciones puras para la lógica de routing y dependencias inyectadas para Pi/FS; evitar side effects al importar el módulo. No crear otro orquestador, CLI de perfiles ni dependencias innecesarias.

### 6.3 Ruta de ejecución

```text
Alt+P / /hprofile claude
  → Cargar y validar JSON
  → Resolver modelos y niveles
  → Si es necesario, esperar un punto seguro del padre
  → pi.setModel + pi.setThinkingLevel
  → Guardar selección en la rama/sesión
  → Actualizar indicador en pantalla

Siguiente agent_spawn (en la misma sesión)
  → hook tool_call (solo agent_spawn)
  → Resolver cada rol por profile o name exacto
  → Inyectar model/thinking según perfil seleccionado
  → Dejar que mavam ejecute el spawn/grafo normalmente
```

**Atomicidad:** ante un error antes de confirmar, mantener el perfil anterior y no alterar ninguna ruta ni archivo. Si falla un cambio parcialmente, restaurar el modelo/thinking anterior cuando sea posible y notificar la inconsistencia. No escribir el estado persistente antes de una activación exitosa.

### 6.4 El punto delicado: delegación anidada

`pi-agents` permite que un especialista con `spawn: true` cree helpers. El `agent_spawn` del **orquestador** y el spawn interno de un **helper** no necesariamente pasan por el mismo hook de Pi. Por eso:

1. **MVP obligatorio:** demostrar routing correcto de los spawns directos del padre (individuales y grafos paralelos).
2. **Investigación de compatibilidad:** inspeccionar la ruta `resolveHelper`, la API/eventos oficiales de `pi-agents` y los mecanismos de extensión documentados para lograr routing también en delegación anidada sin modificar los Markdown.
3. **No monkeypatching** de internos ni edición de `node_modules` como solución predeterminada.
4. Si el runtime actual no expone un hook estable, documentar el límite y preparar una integración/upstream PR pequeño; **no declarar soporte anidado completo** hasta que las pruebas reales lo demuestren.
5. El cambio de perfil nunca migra un agente ya creado a otro modelo: crear un agente nuevo para usar la ruta nueva.

## 7. Migración segura desde v1

La carpeta descomprimida es el punto de partida del repo. El desarrollo no debe instalar o ejecutar simultáneamente dos extensiones que registren el mismo `Alt+P` y `/hprofile`. *(El atajo actual es `Alt+M`; ver §0.)*

1. Inicializar Git en la carpeta extraída; conservar los archivos v1 como referencia en el historial de desarrollo, sin credenciales ni datos personales.
2. Crear una rama de implementación y asegurar un respaldo de los `agents/*.md` si v1 ya fue instalada en `~/.pi/agent/extensions/`.
3. Convertir el JSON histórico: `balanced` se conserva; **`codex-low` → `claude`** por su contenido predominantemente Claude; **`claude-low` → `codex`** por su contenido predominantemente Codex; completar los tres especialistas Gemini en todos los perfiles.
4. Eliminar del nuevo código `patchFrontmatter`, `patchesFor`, `applyFiles`, `restoreFiles`, `storeActive` y la persistencia del campo global `active`.
5. Separar **configuración instalada** de **ejemplo versionado**: no sobrescribir el JSON personal del usuario durante las actualizaciones.
6. Desactivar o retirar de la carpeta global el archivo de extensión v1 antes de habilitar v2; reinstalar/recargar una sola versión.
7. Si v1 dejó modificaciones en los Markdown originales, verificar/restaurar manualmente los valores esperados con copia de seguridad; no borrar instrucciones ni otros campos.
8. Ejecutar primero tests sin invocar modelos de pago. Después, una prueba manual controlada en Pi con Codex, Claude Code y Antigravity realmente conectados.

## 8. Estrategia de pruebas

**Unitarias (obligatorias, rápidas):**

- Válido/inválido: JSON, rutas, thinking, nombres, orden, perfiles faltantes, roles obligatorios. *(«Roles obligatorios» superado; §0.)*
- Conversión de nombres antiguos a nuevos sin intercambiar proveedores.
- `agent_spawn` de un agente con `profile`; fallback exacto por `name`; agente ad hoc sin coincidencia.
- Prioridad `profile-wins` *(superada por explicit-wins; §0)*; aislamiento de elementos de `agents[]` y preservación del resto de argumentos.
- Cambio A→B→C→A; rollback cuando falla autenticación/registro; estado no persistido en fallo.
- Restauración según rama activa, cambio de sesión y no contaminación cruzada.
- Nunca escribir `.md`, `settings.json`, `auth.json`, `mcp.json`, `context-prune/settings.json` ni otros archivos fuera del JSON intencional del usuario. *(Vigente para los demás archivos. Desde 2026-11-10, `/hprofile manage` escribe `profile-cycler.json` y su `.bak` solo tras confirmación; ver §0.)*

**Integración ligera (obligatoria):**

- Pi + mavam disponibles: activar perfil dentro de la **misma conversación**, invocar `agent_spawn`, verificar en la información del agente el proveedor/modelo/effort real.
- Grafo con dos especialistas diferentes; un perfil por ventana de Pi; reanudar sesión con su perfil previo.
- Cambiar de perfil mientras otro agente corre: no interrumpirlo y comprobar el próximo spawn.
- Probar `/hprofile reload`, `/hprofile status`, selección por menú y atajo real en Windows.
- Examinar conflictos de hotkeys/extensiones y fallback de modelos no disponibles.
- Caso de helper anidado: ejecutar y documentar **soportado o no soportado** con evidencia.

**Costo de tests:** no suites E2E pesadas, capturas masivas ni pruebas con LLM costosas por iniciativa propia. Las pruebas reales de proveedores deben ser pocas, acotadas, preferentemente manuales, y con reporte del consumo/resultado. Testear primero con mocks.

## 9. No objetivos

- Crear un nuevo runtime de subagentes o migrar fuera de mavam.
- Realizar login, administrar cuotas, consultar uso de Codex/Claude o cambiar IP.
- Detectar automáticamente límites y cambiar perfiles sin acción humana.
- Modificar permisos, shell, Git, secretos, herramientas del ACP, MCP, skills o pruning.
- Afectar retroactivamente agentes persistentes o ejecuciones en curso.
- Gestionar instrucciones, crear agentes, publicar una UI web, instalar una base de datos o implementar telemetría.

## 10. Fases de desarrollo

### Fase 0 — Inicializar repo sobre v1

- `git init` en la carpeta descomprimida, `.gitignore`, metadata/package y licencia elegida por el propietario. *(Resuelta: licencia MIT; ver §0.)*
- Reestructurar código; actualizar README para que describa este plugin, no una integración ajena.
- Incorporar este PRD y una página de arquitectura.
- Inventariar y conservar comportamiento existente verificable; no hacer refactor sin tests básicos.

### Fase 1 — Configuración y perfiles definitivos

- Implementar schema v2 y ejemplo completo `balanced/claude/codex`.
- Funciones puras de validación y mapping; tests unitarios.
- Quitar cualquier escritura a Markdown o `active` global. *(Los Markdown siguen sin escribirse; `/hprofile manage` escribe solo `profile-cycler.json`; ver §0.)*

### Fase 2 — Routing en caliente

- Model switch del padre con rollback y comprobación de thinking.
- Hook `tool_call` para `agent_spawn`, resolver roles de forma determinista.
- Barra de estado, `Alt+P` *(hoy `Alt+M`; §0)*, comandos y diagnóstico.
- Tests unitarios y primer smoke en Pi.

### Fase 3 — Persistencia y robustez

- Estado de perfil por sesión/rama; restauración y aislamiento de ventanas.
- Cambios durante actividad y fallos de proveedor.
- Tests de integración ligera, sin reconfigurar el harness ajeno.

### Fase 4 — Compatibilidad avanzada y release

- Investigar spawns anidados y añadir soporte solo mediante hook estable comprobado; documentar límite si no es viable aún.
- README de instalación/actualización/desinstalación, troubleshooting y matriz de compatibilidad.
- Verificar desde cero en Windows. Publicar versión inicial del repo; npm opcional cuando exista un proceso de release confiable.

## 11. Definition of Done

- [ ] Perfiles visibles únicamente como `balanced`, `claude` y `codex`; matriz de 8 rutas/roles por perfil conforme a la sección 4. *(Superado 2026-11-10: el ejemplo trae estos tres perfiles, pero se pueden crear más y los siete roles no son obligatorios; ver §0.)*
- [ ] `Alt+P` *(hoy `Alt+M`; §0)* cambia el perfil sin reiniciar y mantiene el mismo historial de conversación.
- [ ] `/hprofile`, `/hprofile <nombre>`, `/hprofile next`, `/hprofile status`, `/hprofile reload` funcionan.
- [ ] Los **nuevos spawns directos** usan efectivamente el modelo/thinking del perfil vigente en esa sesión, en una llamada individual o un grafo.
- [ ] Una sesión ya iniciada puede usar varios perfiles sucesivos; los agentes anteriores conservan su ruta.
- [ ] Dos sesiones concurrentes no modifican el perfil una de otra.
- [ ] Ningún cambio de perfil escribe `agents/*.md`, archivos globales de Pi ni credenciales. *(Vigente para cambios de perfil; `/hprofile manage` escribe solo `profile-cycler.json`, ver §0.)*
- [ ] Al reanudar sesión y navegar ramas, la selección se restaura según política documentada y verificada.
- [ ] Modelos inexistentes y fallos no confirman una activación falsa.
- [ ] Delegación anidada: prueba documentada con resultado explícito; no prometer soporte no implementado.
- [ ] Tests automatizados rápidos, chequeos de tipos y README de instalación clara.
- [ ] Nunca se cargan dos variantes del plugin a la vez ni se pierden los ajustes personalizados al actualizar.

## 12. Instrucción de arranque para el agente implementador

> Trabajá dentro de este repositorio inicializado a partir del ZIP v1. Usá este PRD como fuente canónica. Primero auditá la implementación actual, listá brevemente discrepancias contra el PRD y proponé/ejecutá las fases 0 y 1. Después implementá routing en caliente de `agent_spawn` y persistencia por sesión, con tests unitarios antes del smoke real. Mantené `mavam/pi-agents` como orquestador, no modifiques `~/.pi/agent` del usuario ni credenciales durante el desarrollo, no sobrescribas Markdown de los agentes y no instales un segundo runtime. Para subagentes anidados, verificá un punto de extensión estable; si no existe, registrá la limitación sin simular compatibilidad. Entregá resumen de cambios, pruebas ejecutadas, riesgos y próximos pasos.
