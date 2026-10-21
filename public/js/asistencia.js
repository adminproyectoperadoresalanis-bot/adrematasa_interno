import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";

// ============================================================================
// Operadores → Asistencia (2026-10-20, pedido de Ivan).
//
// Pago diario a operadores de RUTA CORTA. Semana de lunes a domingo. El cálculo
// lo hace la Cloud Function calcularAsistenciaSemana (operadoresAlanis.js):
// día pagable = entrada a patio + (Disponible vigente hasta la hora de corte,
// viaje aceptado o taller). Disponible vencido se muestra pero no se paga.
// Coordinador / Supervisor / Auxiliar / admin pueden ajustar un día con motivo
// y autorizar la semana (queda congelada). Reabrir: admin o los puestos que se
// marquen en Configuración. Exportar a Excel desde aquí.
// ============================================================================

const funciones = getFunctions(undefined, "us-central1");
const fnCalcular = httpsCallable(funciones, "calcularAsistenciaSemana", { timeout: 120000 });
const fnAjustar = httpsCallable(funciones, "ajustarAsistenciaDia");
const fnAutorizar = httpsCallable(funciones, "autorizarAsistenciaSemana", { timeout: 120000 });
const fnReabrir = httpsCallable(funciones, "reabrirAsistenciaSemana");

const URL_SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const DIAS_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const CODIGOS = {
  disponible: { icono: "✔", txt: "Disp.", clase: "as-pago", largo: "Disponible" },
  viaje: { icono: "🚛", txt: "Viaje", clase: "as-pago as-viaje", largo: "Aceptó viaje" },
  taller: { icono: "🔧", txt: "Taller", clase: "as-pago as-taller", largo: "En taller" },
  vencido: { icono: "⌛", txt: "Vencido", clase: "as-venc", largo: "Disponible vencido (no paga)" },
  sin_entrada: { icono: "—", txt: "Sin entrada", clase: "as-nada", largo: "Sin entrada a patio" },
  nada: { icono: "—", txt: "No se reportó", clase: "as-nada", largo: "No se reportó" },
  futuro: { icono: "", txt: "", clase: "as-futuro", largo: "" },
};

let semanaRecordada = null; // la última semana vista en esta sesión

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
function dinero(n) {
  return "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function lunesDe(fecha) {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  const dia = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dia);
  return d;
}
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function desdeIso(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function etiquetaSemana(lunesIso) {
  const a = desdeIso(lunesIso);
  const b = new Date(a); b.setDate(b.getDate() + 6);
  return `Lun ${a.getDate()} ${a.getMonth() !== b.getMonth() ? MESES[a.getMonth()] + " " : ""}– Dom ${b.getDate()} ${MESES[b.getMonth()]} ${b.getFullYear()}`;
}
function horaDe(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fechaHora(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${horaDe(ms)}`;
}
function textoCorreo(c) {
  if (!c) return " · correo: enviando…";
  if (c.estado === "enviado") return ` · correo enviado ${fechaHora(c.ms)}`;
  if (c.estado === "sin_destinatarios") return " · ⚠️ correo no enviado: faltan destinatarios en Configuración";
  return " · ⚠️ el correo no se pudo enviar";
}
function mensajeError(err, porDefecto) {
  return (err && err.message && !/^internal$/i.test(err.message)) ? err.message : porDefecto;
}

function inyectarEstilos() {
  if (document.getElementById("estilos-asistencia")) return;
  const s = document.createElement("style");
  s.id = "estilos-asistencia";
  s.textContent = `
    .as-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
    .as-sem { display: flex; align-items: center; gap: 6px; }
    .as-sem b { border: 1px solid #e2ddd5; border-radius: 8px; padding: 6px 10px; font-size: 14px; white-space: nowrap; }
    .as-flecha { min-width: 0; padding: 6px 12px; }
    .as-estado { margin: 12px 0; border-radius: 10px; padding: 10px 12px; font-size: 13px; display: flex; justify-content: space-between; gap: 10px; align-items: center; flex-wrap: wrap; }
    .as-estado.abierta { background: #FBE3A8; border-left: 6px solid #B45309; }
    .as-estado.autorizada { background: #DCEFCF; border-left: 6px solid #3B7A1E; }
    .as-estado .as-bot { display: flex; gap: 6px; flex-wrap: wrap; }
    .as-tabla { border-collapse: separate; border-spacing: 0; width: 100%; min-width: 820px; font-size: 13px; }
    .as-tabla th { font-size: 11.5px; color: #6b5f52; text-transform: uppercase; letter-spacing: .3px; padding: 8px 4px; text-align: center; font-weight: 600; border-bottom: 1px solid #e2ddd5; }
    .as-tabla td { padding: 5px 4px; text-align: center; border-bottom: 1px solid #f0ece6; }
    .as-tabla .izq { text-align: left; }
    .as-op b { display: block; font-size: 14px; } .as-op small { color: #6b5f52; font-size: 11.5px; }
    .as-dia { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; width: 64px; height: 46px; border-radius: 9px; font-size: 11px; font-weight: 700; line-height: 1.15; border: none; font-family: inherit; cursor: pointer; position: relative; }
    .as-dia i { font-style: normal; font-size: 15px; }
    .as-pago { background: #B9E3A0; color: #1F1A14; box-shadow: inset 0 0 0 1.5px #3B7A1E; }
    .as-pago.as-taller { background: #F5B7B1; box-shadow: inset 0 0 0 1.5px #C0392B; }
    .as-pago.as-viaje { background: #CFE2F7; box-shadow: inset 0 0 0 1.5px #185FA5; }
    .as-venc { background: #FBE3A8; color: #7a3e06; }
    .as-nada { background: #F1EFE8; color: #9A938A; }
    .as-futuro { background: transparent; border: 1px dashed #e2ddd5; cursor: default; }
    .as-dia.as-ajustado::after { content: '✎'; position: absolute; top: -6px; right: -6px; background: #2C1E0F; color: #fff; width: 16px; height: 16px; border-radius: 50%; font-size: 10px; display: flex; align-items: center; justify-content: center; }
    .as-dia.as-nopaga-ajuste { background: #F1EFE8; color: #6b5f52; box-shadow: inset 0 0 0 1.5px #9A938A; text-decoration: line-through; }
    .as-tot { font-weight: 800; font-size: 14px; }
    .as-monto { font-weight: 800; font-size: 14px; color: #27500A; white-space: nowrap; }
    .as-tabla tfoot td { border-bottom: none; font-weight: 800; padding-top: 10px; }
    .as-leyenda { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 12px; font-size: 12px; color: #3D342B; }
    .as-leyenda span { display: inline-flex; gap: 6px; align-items: center; }
    .as-leyenda .as-dia { width: 34px; height: 22px; font-size: 10px; cursor: default; }
    .as-linea { display: flex; gap: 10px; padding: 6px 0; border-bottom: 1px solid #f0ece6; font-size: 13px; }
    .as-linea span:first-child { width: 48px; color: #6b5f52; font-weight: 700; flex-shrink: 0; }
    .as-res { margin-top: 10px; border-radius: 9px; padding: 8px 10px; font-weight: 700; font-size: 13px; }
    .as-res.si { background: #DCEFCF; color: #27500A; } .as-res.no { background: #F1EFE8; color: #6b5f52; }
    .as-radios { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 6px; font-size: 13px; }
    .as-radios label { display: inline-flex; gap: 5px; align-items: center; margin: 0; color: #2c1e0f; }
    .as-aviso { font-size: 12.5px; color: #92400e; margin: 6px 0 0; }
    .as-radios input { width: auto !important; }
    /* Mismo modal que operadores.js (por si se abre Asistencia primero). */
    .op-sub { font-size: 12px; color: #6b5f52; }
    .op-fecha { font-size: 12px; color: #6b5f52; white-space: nowrap; margin-left: auto; }
    .op-modal-fondo { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 1000; display: flex;
      align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
    .op-modal { background: #fff; border-radius: 16px; width: 100%; max-width: 420px; max-height: 88vh;
      overflow-y: auto; padding: 22px; box-sizing: border-box; color: #2c1e0f; }
    .op-modal label { display: block; font-size: 12px; color: #6b5f52; margin: 14px 0 4px; }
    .op-modal input, .op-modal select { width: 100%; box-sizing: border-box; }
    .op-botones { display: flex; gap: 8px; margin-top: 20px; }
    .op-botones button { flex: 1; }
  `;
  document.head.appendChild(s);
}

export function iniciarAsistencia(contenedor) {
  inyectarEstilos();
  const lunesActual = iso(lunesDe(new Date()));
  let semana = semanaRecordada || lunesActual;
  let datos = null;

  contenedor.innerHTML = `
    <section class="panel">
      <div class="as-top">
        <h2 style="margin:0;">Asistencia · ruta corta</h2>
        <div class="as-sem">
          <button type="button" class="secundario as-flecha" id="as-prev" aria-label="Semana anterior">‹</button>
          <b id="as-etq"></b>
          <button type="button" class="secundario as-flecha" id="as-sig" aria-label="Semana siguiente">›</button>
        </div>
      </div>
      <div id="as-estado"></div>
      <div id="as-error" class="error"></div>
      <p id="as-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div class="tabla-wrap" id="as-tabla"><p class="nota">Calculando…</p></div>
      <div class="as-leyenda">
        <span><span class="as-dia as-pago"><i>✔</i></span>Disponible (paga)</span>
        <span><span class="as-dia as-pago as-viaje"><i>🚛</i></span>Aceptó viaje (paga)</span>
        <span><span class="as-dia as-pago as-taller"><i>🔧</i></span>En taller (paga)</span>
        <span><span class="as-dia as-venc"><i>⌛</i></span>Disponible vencido (no paga)</span>
        <span><span class="as-dia as-nada"><i>—</i></span>Sin entrada / no se reportó</span>
        <span><span class="as-dia as-pago as-ajustado"><i>✔</i></span>Ajustado a mano</span>
      </div>
      <p class="nota" style="margin-top:10px;">Toca un día para ver de dónde sale el resultado. Las entradas a patio cuentan desde que se empezó a guardar su historial (20/10/2026).</p>
    </section>
  `;
  const $ = (s) => contenedor.querySelector(s);

  async function cargar() {
    semanaRecordada = semana;
    $("#as-etq").textContent = etiquetaSemana(semana);
    $("#as-sig").disabled = semana >= lunesActual;
    $("#as-error").textContent = "";
    $("#as-tabla").innerHTML = `<p class="nota">Calculando…</p>`;
    $("#as-estado").innerHTML = "";
    try {
      const res = await fnCalcular({ lunes: semana });
      if (res.data.semana !== semana) return; // cambiaron de semana mientras calculaba
      datos = res.data;
      render();
    } catch (err) {
      $("#as-tabla").innerHTML = "";
      $("#as-error").textContent = mensajeError(err, "No se pudo calcular la asistencia.");
    }
  }

  function render() {
    const d = datos;
    const semanaTerminada = semana < lunesActual;
    const autorizada = d.estado === "autorizada";
    let botones = `<button type="button" class="secundario" id="as-excel">Exportar Excel</button>`;
    if (!autorizada) botones += `<button type="button" class="secundario" id="as-recalc">Actualizar</button>`;
    if (!autorizada && d.permisos.revisar && semanaTerminada) botones += `<button type="button" id="as-autorizar">Autorizar semana</button>`;
    if (autorizada && d.permisos.reabrir) botones += `<button type="button" class="secundario" id="as-reabrir">Reabrir</button>`;
    const texto = autorizada
      ? `<b>Semana autorizada</b> por ${esc(d.autorizadaPor && d.autorizadaPor.nombre || "—")} el ${fechaHora(d.autorizadaMs)} · pago por día: <b>${dinero(d.pagoDia)}</b>${textoCorreo(d.correo)}`
      : `<b>${semanaTerminada ? "Semana por revisar" : "Semana en curso"}</b> · pago por día: <b>${dinero(d.pagoDia)}</b> · corte del día ${esc(d.horaCorte)}${d.reabiertaPor ? ` · reabierta por ${esc(d.reabiertaPor.nombre)} (${esc(d.reabiertaPor.motivo)})` : ""}`;
    $("#as-estado").innerHTML = `
      <div class="as-estado ${autorizada ? "autorizada" : "abierta"}">
        <span>${texto}</span><span class="as-bot">${botones}</span>
      </div>
      ${!d.pagoDia ? `<p class="as-aviso">⚠️ Falta capturar el pago por día en Configuración → 2 · Utilidades → Operadores.</p>` : ""}
      ${!autorizada && !semanaTerminada ? `<p class="as-aviso" style="color:#6b5f52;">La semana se puede autorizar cuando termine (domingo a medianoche).</p>` : ""}`;

    if (!d.filas.length) {
      $("#as-tabla").innerHTML = `<p class="nota" style="text-align:center;padding:16px;">No hay operadores con ruta corta. Asígnala en Operadores registrados.</p>`;
    } else {
      const cab = d.fechas.map((f, i) => `<th>${DIAS_CORTOS[i]} ${Number(f.slice(8))}</th>`).join("");
      const filas = d.filas.map((f, fi) => `
        <tr>
          <td class="izq as-op"><b>${esc(f.unidad || "—")}</b><small>${esc(f.nombre)}${f.activo ? "" : " · inactivo"}</small></td>
          ${f.dias.map((dia, di) => {
            const c = CODIGOS[dia.codigo] || CODIGOS.nada;
            if (dia.codigo === "futuro") return `<td><span class="as-dia as-futuro"></span></td>`;
            let clase = c.clase, icono = c.icono, txt = c.txt;
            if (dia.ajuste) {
              if (dia.ajuste.pagar) { if (!dia.pagaCalculado) { clase = "as-pago"; icono = "✔"; txt = "Pagado"; } }
              else { clase = "as-nopaga-ajuste"; }
              clase += " as-ajustado";
            }
            return `<td><button type="button" class="as-dia ${clase}" data-f="${fi}" data-d="${di}"><i>${icono}</i>${esc(txt)}</button></td>`;
          }).join("")}
          <td class="as-tot">${f.totalDias}</td>
          <td class="as-monto">${dinero(f.monto)}</td>
        </tr>`).join("");
      $("#as-tabla").innerHTML = `
        <table class="as-tabla">
          <thead><tr><th class="izq">Operador</th>${cab}<th>Días</th><th>Pago</th></tr></thead>
          <tbody>${filas}</tbody>
          <tfoot><tr><td class="izq">${d.filas.length} operador${d.filas.length === 1 ? "" : "es"}</td><td colspan="7"></td><td class="as-tot">${d.totales.dias}</td><td class="as-monto">${dinero(d.totales.monto)}</td></tr></tfoot>
        </table>`;
      $("#as-tabla").querySelectorAll(".as-dia[data-f]").forEach(b => b.addEventListener("click", () => {
        abrirDia(d.filas[Number(b.dataset.f)], d.filas[Number(b.dataset.f)].dias[Number(b.dataset.d)], !autorizada && d.permisos.revisar);
      }));
    }

    const q = (s) => $("#as-estado").querySelector(s);
    q("#as-excel") && q("#as-excel").addEventListener("click", exportarExcel);
    q("#as-recalc") && q("#as-recalc").addEventListener("click", cargar);
    q("#as-autorizar") && q("#as-autorizar").addEventListener("click", autorizar);
    q("#as-reabrir") && q("#as-reabrir").addEventListener("click", reabrir);
  }

  function avisar(t) {
    $("#as-exito").textContent = t;
    $("#as-exito").classList.remove("oculto");
    setTimeout(() => $("#as-exito").classList.add("oculto"), 5000);
  }

  function abrirDia(fila, dia, puedeAjustar) {
    const c = CODIGOS[dia.codigo] || CODIGOS.nada;
    const fondo = document.createElement("div");
    fondo.className = "op-modal-fondo";
    const lineas = dia.detalle.length
      ? dia.detalle.map(x => `<div class="as-linea"><span>${horaDe(x.ms)}</span><span>${esc(x.txt)}</span></div>`).join("")
      : `<p class="nota">Sin movimientos este día.</p>`;
    const f = desdeIso(dia.fecha);
    fondo.innerHTML = `
      <div class="op-modal" role="dialog" aria-modal="true">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
          <div style="font-size:16px;font-weight:700;">${esc(fila.unidad)} · ${esc(fila.nombre)}</div>
          <button type="button" class="secundario op-cerrar" aria-label="Cerrar">✕</button>
        </div>
        <div class="op-sub" style="margin-bottom:8px;">${DIAS_CORTOS[(f.getDay() + 6) % 7]} ${f.getDate()} ${MESES[f.getMonth()]} · cálculo: ${esc(c.largo)}</div>
        ${lineas}
        <div class="as-res ${dia.paga ? "si" : "no"}">${dia.paga ? "✔ Día pagable · " + dinero(datos.pagoDia) : "✖ No se paga"}${dia.ajuste ? ` (ajustado por ${esc(dia.ajuste.porNombre)}: "${esc(dia.ajuste.motivo)}")` : ""}</div>
        ${puedeAjustar ? `
          <label style="margin-top:12px;">Ajustar este día</label>
          <div class="as-radios">
            <label><input type="radio" name="as-aj" value="si"${dia.ajuste && dia.ajuste.pagar ? " checked" : ""}> Pagar</label>
            <label><input type="radio" name="as-aj" value="no"${dia.ajuste && !dia.ajuste.pagar ? " checked" : ""}> No pagar</label>
            ${dia.ajuste ? `<label><input type="radio" name="as-aj" value="quitar"> Quitar ajuste (usar el cálculo)</label>` : ""}
          </div>
          <label>Motivo (obligatorio)</label>
          <input type="text" class="as-motivo" maxlength="300" placeholder="Ej: se le descargó el celular, estuvo en patio todo el día" value="${dia.ajuste ? esc(dia.ajuste.motivo) : ""}">
          <div class="error as-m-error" style="margin-top:8px;"></div>
          <div class="op-botones"><button type="button" class="secundario op-cerrar2">Cerrar</button><button type="button" class="as-guardar">Guardar ajuste</button></div>
        ` : `<div class="op-botones"><button type="button" class="secundario op-cerrar2">Cerrar</button></div>`}
      </div>`;
    document.body.appendChild(fondo);
    const cerrar = () => fondo.remove();
    fondo.querySelector(".op-cerrar").addEventListener("click", cerrar);
    fondo.querySelector(".op-cerrar2").addEventListener("click", cerrar);
    fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });
    const btn = fondo.querySelector(".as-guardar");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const err = fondo.querySelector(".as-m-error");
      err.textContent = "";
      const sel = fondo.querySelector('input[name="as-aj"]:checked');
      if (!sel) { err.textContent = "Elige Pagar o No pagar."; return; }
      const motivo = fondo.querySelector(".as-motivo").value.trim();
      if (sel.value !== "quitar" && !motivo) { err.textContent = "Escribe el motivo."; return; }
      btn.disabled = true;
      try {
        await fnAjustar({ lunes: semana, uid: fila.uid, fecha: dia.fecha, pagar: sel.value === "quitar" ? null : sel.value === "si", motivo });
        cerrar();
        avisar("Ajuste guardado.");
        cargar();
      } catch (e) {
        err.textContent = mensajeError(e, "No se pudo guardar el ajuste.");
        btn.disabled = false;
      }
    });
  }

  async function autorizar() {
    if (!confirm(`¿Autorizar la asistencia de la semana ${etiquetaSemana(semana)}?\n\nTotal: ${datos.totales.dias} días · ${dinero(datos.totales.monto)}.\nYa no cambiará aunque lleguen movimientos atrasados.`)) return;
    try {
      const res = await fnAutorizar({ lunes: semana });
      avisar(`Semana autorizada · ${res.data.totales.dias} días · ${dinero(res.data.totales.monto)}.`);
      cargar();
    } catch (e) {
      $("#as-error").textContent = mensajeError(e, "No se pudo autorizar la semana.");
    }
  }

  async function reabrir() {
    const motivo = prompt("Motivo para reabrir la semana:");
    if (motivo === null) return;
    if (!motivo.trim()) { $("#as-error").textContent = "Escribe el motivo para reabrir."; return; }
    try {
      await fnReabrir({ lunes: semana, motivo: motivo.trim() });
      avisar("Semana reabierta.");
      cargar();
    } catch (e) {
      $("#as-error").textContent = mensajeError(e, "No se pudo reabrir la semana.");
    }
  }

  function cargarSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = URL_SHEETJS;
      s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error("No cargó la librería de Excel.")));
      s.onerror = () => reject(new Error("No se pudo cargar la librería de Excel."));
      document.head.appendChild(s);
    });
  }

  async function exportarExcel() {
    if (!datos) return;
    try {
      const XLSX = await cargarSheetJS();
      const d = datos;
      const cab = ["Unidad", "Operador", ...d.fechas.map((f, i) => `${DIAS_CORTOS[i]} ${f.slice(8)}/${f.slice(5, 7)}`), "Días pagados", "Pago"];
      const filas = d.filas.map(f => [
        f.unidad, f.nombre,
        ...f.dias.map(x => x.codigo === "futuro" ? "" : (x.paga ? "PAGA" : (CODIGOS[x.codigo] || CODIGOS.nada).largo) + (x.ajuste ? " (ajuste)" : "")),
        f.totalDias, f.monto,
      ]);
      const total = ["", "TOTAL", ...d.fechas.map(() => ""), d.totales.dias, d.totales.monto];
      const encabezado = [
        [`Asistencia ruta corta · ${etiquetaSemana(semana)}`],
        [d.estado === "autorizada" ? `Autorizada por ${(d.autorizadaPor && d.autorizadaPor.nombre) || ""} el ${fechaHora(d.autorizadaMs)}` : "PRELIMINAR · sin autorizar"],
        [`Pago por día: ${dinero(d.pagoDia)}`],
        [],
      ];
      const hoja = XLSX.utils.aoa_to_sheet([...encabezado, cab, ...filas, total]);
      hoja["!cols"] = [{ wch: 8 }, { wch: 32 }, ...d.fechas.map(() => ({ wch: 14 })), { wch: 12 }, { wch: 10 }];
      const ajustes = [];
      d.filas.forEach(f => f.dias.forEach(x => { if (x.ajuste) ajustes.push([f.unidad, f.nombre, x.fecha, x.ajuste.pagar ? "Pagar" : "No pagar", x.ajuste.motivo, x.ajuste.porNombre]); }));
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja, "Asistencia");
      if (ajustes.length) XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([["Unidad", "Operador", "Fecha", "Ajuste", "Motivo", "Ajustó"], ...ajustes]), "Ajustes");
      XLSX.writeFile(libro, `Asistencia_ruta_corta_${semana}.xlsx`);
    } catch (e) {
      $("#as-error").textContent = mensajeError(e, "No se pudo generar el Excel.");
    }
  }

  $("#as-prev").addEventListener("click", () => {
    const d = desdeIso(semana); d.setDate(d.getDate() - 7); semana = iso(d); cargar();
  });
  $("#as-sig").addEventListener("click", () => {
    const d = desdeIso(semana); d.setDate(d.getDate() + 7);
    if (iso(d) <= lunesActual) { semana = iso(d); cargar(); }
  });
  cargar();
}