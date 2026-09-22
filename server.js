require("dotenv").config();

const express = require("express");
const axios = require("axios");
const XLSX = require("xlsx");
const multer = require("multer");
const https = require("https");
const cors = require("cors");

// ============================================================
// CONFIGURAÇÕES
// ============================================================

const PORT = process.env.PORT || 3000;

const app = express();

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

// ============================================================
// UPLOAD
// ============================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024
  }
});

// ============================================================
// NEW CORBAN
// ============================================================

const NEW = {
  IEV: {
    TOKEN: process.env.IEV_NEWCORBAN_TOKEN,
    BASE_URL: process.env.IEV_NEWCORBAN_BASE_URL
  },

  CS: {
    TOKEN: process.env.CS_NEWCORBAN_TOKEN,
    BASE_URL: process.env.CS_NEWCORBAN_BASE_URL
  }
};

if (
  !NEW.IEV.TOKEN ||
  !NEW.IEV.BASE_URL ||
  !NEW.CS.TOKEN ||
  !NEW.CS.BASE_URL
) {
  console.error("============================================");
  console.error("ERRO: Variáveis do NEW CORBAN não configuradas");
  console.error("============================================");

  console.error("NECORBAN_IEV_TOKEN:", !!NEW.IEV.TOKEN);
  console.error("NECORBAN_IEV_BASE_URL:", !!NEW.IEV.BASE_URL);
  console.error("NECORBAN_CS_TOKEN:", !!NEW.CS.TOKEN);
  console.error("NECORBAN_CS_BASE_URL:", !!NEW.CS.BASE_URL);

  process.exit(1);
}

// ============================================================
// IN100
// ============================================================

const IN100_APIKEY = process.env.IN100_APIKEY;

const IN100_BASE_URL =
  process.env.IN100_BASE_URL ||
  "https://integration.ajin.io";

if (!IN100_APIKEY) {
  console.warn("ATENÇÃO: IN100_APIKEY não configurada.");
}

// ============================================================
// AXIOS
// ============================================================

const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true
});

// ============================================================
// ESTADO DO PROCESSAMENTO
// ============================================================

let processamento = {
  executando: false,
  etapa: "parado",

  corban: null,

  total: 0,
  processados: 0,

  desbloqueados: 0,
  bloqueados: 0,

  bloqueadosConcessao: 0,
  bloqueadosBeneficiario: 0,

  beneficiosInvalidos: 0,

  erros: 0,

  atualizacoes: [],

  logs: [],

  confirmado: false,

  arquivo: null,

  inicio: null,
  fim: null
};

// ============================================================
// SSE
// ============================================================

const clientesSSE = [];

function enviarEvento(tipo, dados = {}) {
  const evento = JSON.stringify({
    tipo,
    dados
  });

  for (let i = clientesSSE.length - 1; i >= 0; i--) {
    const cliente = clientesSSE[i];

    try {
      cliente.write(`data: ${evento}\n\n`);
    } catch (erro) {
      clientesSSE.splice(i, 1);
    }
  }
}

function adicionarLog(mensagem) {
  const texto = `[${new Date().toLocaleTimeString("pt-BR")}] ${mensagem}`;

  processamento.logs.push(texto);

  // Evita crescimento infinito
  if (processamento.logs.length > 1000) {
    processamento.logs.shift();
  }

  console.log(texto);

  enviarEvento("log", {
    mensagem: texto
  });
}

function enviarEstado() {
  enviarEvento("estado", {
    executando: processamento.executando,
    etapa: processamento.etapa,

    corban: processamento.corban,

    total: processamento.total,
    processados: processamento.processados,

    desbloqueados: processamento.desbloqueados,
    bloqueados: processamento.bloqueados,

    bloqueadosConcessao:
      processamento.bloqueadosConcessao,

    bloqueadosBeneficiario:
      processamento.bloqueadosBeneficiario,

    beneficiosInvalidos:
      processamento.beneficiosInvalidos,

    erros: processamento.erros,

    atualizacoes: processamento.atualizacoes,

    confirmado: processamento.confirmado,

    arquivo: processamento.arquivo,

    inicio: processamento.inicio,
    fim: processamento.fim
  });
}

// ============================================================
// SSE ENDPOINT
// ============================================================

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  if (res.flushHeaders) {
    res.flushHeaders();
  }

  res.write(": conectado\n\n");

  clientesSSE.push(res);

  // Envia estado atual imediatamente
  try {
    res.write(
      `data: ${JSON.stringify({
        tipo: "estado",
        dados: {
          executando: processamento.executando,
          etapa: processamento.etapa,
          corban: processamento.corban,
          total: processamento.total,
          processados: processamento.processados,
          desbloqueados: processamento.desbloqueados,
          bloqueados: processamento.bloqueados,
          bloqueadosConcessao:
            processamento.bloqueadosConcessao,
          bloqueadosBeneficiario:
            processamento.bloqueadosBeneficiario,
          beneficiosInvalidos:
            processamento.beneficiosInvalidos,
          erros: processamento.erros,
          atualizacoes: processamento.atualizacoes,
          confirmado: processamento.confirmado,
          arquivo: processamento.arquivo,
          inicio: processamento.inicio,
          fim: processamento.fim
        }
      })}\n\n`
    );
  } catch (erro) {}

  req.on("close", () => {
    const index = clientesSSE.indexOf(res);

    if (index !== -1) {
      clientesSSE.splice(index, 1);
    }
  });
});

// ============================================================
// HELPERS
// ============================================================

function somenteNumeros(valor) {
  if (valor === null || valor === undefined) {
    return "";
  }

  return String(valor).replace(/\D/g, "");
}

function normalizarTexto(valor) {
  if (valor === null || valor === undefined) {
    return "";
  }

  return String(valor).trim();
}

// ============================================================
// FORMATAÇÃO CPF
// ============================================================

function formatarCPF(valor) {
  let cpf = somenteNumeros(valor);

  if (!cpf) {
    return "";
  }

  cpf = cpf.padStart(11, "0");

  if (cpf.length > 11) {
    cpf = cpf.slice(-11);
  }

  return cpf.replace(
    /^(\d{3})(\d{3})(\d{3})(\d{2})$/,
    "$1.$2.$3-$4"
  );
}

// ============================================================
// FORMATAÇÃO BENEFÍCIO
// ============================================================

function formatarBeneficio(valor) {
  let numero = somenteNumeros(valor);

  if (!numero) {
    return "";
  }

  // BENEFÍCIO = 11 DÍGITOS
  numero = numero.padStart(11, "0");

  if (numero.length > 11) {
    numero = numero.slice(-11);
  }

  return numero;
}

// ============================================================
// LEITURA DA PLANILHA
// ============================================================

function lerPlanilha(buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false
  });

  const nomeAba = workbook.SheetNames[0];

  const sheet = workbook.Sheets[nomeAba];

  const dados = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: ""
  });

  if (!dados || dados.length === 0) {
    return [];
  }

  // A primeira linha é o cabeçalho.
  // Ignoramos completamente os títulos.
  const linhas = dados.slice(1);

  return linhas
    .map((linha) => {
      const cpf = formatarCPF(linha[0]);
      const beneficio = formatarBeneficio(linha[1]);

      return {
        cpf,
        beneficio
      };
    })
    .filter((item) => item.cpf || item.beneficio);
}

// ============================================================
// CRIAR API NEW CORBAN
// ============================================================

function criarAPI(corban) {
  const configuracao = NEW[corban];

  if (!configuracao) {
    throw new Error(`Corban inválido: ${corban}`);
  }

  return axios.create({
    baseURL: configuracao.BASE_URL,

    timeout: 120000,

    httpsAgent,

    headers: {
      Authorization: `Bearer ${configuracao.TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    }
  });
}

// ============================================================
// GET CLIENTE COM RETRY
// ============================================================

async function buscarClienteComRetry(api, cpf) {
  let ultimaErro;

  for (let tentativa = 1; tentativa <= 6; tentativa++) {
    try {
      return await api.get(
        `/customers?document=${somenteNumeros(cpf)}`
      );
    } catch (erro) {
      ultimaErro = erro;

      const status = erro.response?.status;

      console.error(
        `Erro GET cliente ${cpf} - tentativa ${tentativa}/6 - HTTP ${status || "?"}`
      );

      if (status !== 429 && status !== 502 && status !== 503) {
        throw erro;
      }

      const espera = tentativa * 1500;

      await new Promise((resolve) =>
        setTimeout(resolve, espera)
      );
    }
  }

  throw ultimaErro;
}

// ============================================================
// PUT COM RETRY
// ============================================================

async function atualizarBeneficioComRetry(
  api,
  customerId,
  benefitId,
  payload
) {
  let ultimaErro;

  for (let tentativa = 1; tentativa <= 6; tentativa++) {
    try {
      return await api.put(
        `/customers/${customerId}/benefits/${benefitId}`,
        payload
      );
    } catch (erro) {
      ultimaErro = erro;

      const status = erro.response?.status;

      console.error(
        `Erro PUT benefício ${benefitId} - tentativa ${tentativa}/6 - HTTP ${status || "?"}`
      );

      if (status !== 429 && status !== 502 && status !== 503) {
        throw erro;
      }

      const espera = tentativa * 1500;

      await new Promise((resolve) =>
        setTimeout(resolve, espera)
      );
    }
  }

  throw ultimaErro;
}

// ============================================================
// CONSULTA IN100
// ============================================================

async function consultarIN100(cpf, beneficio) {
  const cpfNumerico = somenteNumeros(cpf);

  const beneficioNumerico = somenteNumeros(beneficio);

  const url =
    `${IN100_BASE_URL}/v3/query-inss-balances/finder/await`;

  const params = {
    identity: cpfNumerico,
    benefitNumber: beneficioNumerico,
    lastHours: 1,
    timeout: 120
  };

  try {
    const resposta = await axios.get(url, {
      params,

      timeout: 150000,

      httpsAgent,

      headers: {
        Authorization: `Bearer ${IN100_APIKEY}`,
        "x-api-key": IN100_APIKEY,
        Accept: "application/json"
      }
    });

    const resultado = resposta.data;

    // ========================================================
    // RESPOSTA CONHECIDA DA AJIN
    // ========================================================

    if (resultado?.status?.key === "success") {
      return resultado;
    }

    if (resultado?.status?.key === "error") {
      throw new Error(
        resultado?.status?.message ||
        resultado?.message ||
        "Erro retornado pela API IN100"
      );
    }

    throw new Error(
      `Status IN100 inesperado: ${JSON.stringify(resultado)}`
    );

  } catch (erro) {
    const status = erro.response?.status;

    const mensagem =
      erro.response?.data?.message ||
      erro.response?.data?.status?.message ||
      erro.message ||
      "Erro desconhecido";

    console.error(
      `IN100 erro ${cpfNumerico}/${beneficioNumerico}: HTTP ${status || "?"} - ${mensagem}`
    );

    throw erro;
  }
}

// ============================================================
// INTERVALO
// ============================================================

function esperar(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

// ============================================================
// PROCESSAMENTO PRINCIPAL
// ============================================================

async function processarArquivo(buffer, corban) {
  processamento.executando = true;
  processamento.etapa = "analisando";
  processamento.corban = corban;

  processamento.processados = 0;

  processamento.desbloqueados = 0;
  processamento.bloqueados = 0;

  processamento.bloqueadosConcessao = 0;
  processamento.bloqueadosBeneficiario = 0;

  processamento.beneficiosInvalidos = 0;

  processamento.erros = 0;

  processamento.atualizacoes = [];
  processamento.logs = [];

  processamento.confirmado = false;

  processamento.inicio = new Date().toISOString();
  processamento.fim = null;

  enviarEstado();

  try {
    adicionarLog("Lendo planilha...");

    const registros = lerPlanilha(buffer);

    processamento.total = registros.length;

    adicionarLog(
      `Planilha carregada: ${processamento.total} registros.`
    );

    enviarEstado();

    if (processamento.total === 0) {
      throw new Error(
        "Nenhum registro válido encontrado na planilha."
      );
    }

    const api = criarAPI(corban);

    // ========================================================
    // PRIMEIRA ETAPA
    // CONSULTA + IN100
    // ========================================================

    for (let i = 0; i < registros.length; i++) {
      const registro = registros[i];

      const cpf = registro.cpf;
      const beneficioNumero = registro.beneficio;

      const numeroAtual = i + 1;

      adicionarLog(
        `Consultando ${numeroAtual}/${processamento.total} — ${cpf} / ${beneficioNumero}`
      );

      // ------------------------------------------------------
      // VALIDAÇÃO
      // ------------------------------------------------------

      if (!cpf || somenteNumeros(cpf).length !== 11) {
        processamento.erros++;

        adicionarLog(
          `CPF inválido na linha ${numeroAtual}: ${cpf || "(vazio)"}`
        );

        processamento.processados = numeroAtual;

        enviarEstado();

        continue;
      }

      // BENEFÍCIO TEM 11 DÍGITOS
      if (
        !beneficioNumero ||
        somenteNumeros(beneficioNumero).length !== 11
      ) {
        processamento.erros++;

        adicionarLog(
          `Benefício inválido na linha ${numeroAtual}: ${beneficioNumero || "(vazio)"}`
        );

        processamento.processados = numeroAtual;

        enviarEstado();

        continue;
      }

      try {
        // ====================================================
        // BUSCA CLIENTE
        // ====================================================

        adicionarLog(
          `Buscando cliente no New Corban: ${somenteNumeros(cpf)}`
        );

        const respostaCliente =
          await buscarClienteComRetry(api, cpf);

        // ====================================================
        // IMPORTANTE:
        // A RESPOSTA É:
        //
        // response.data.success
        // response.data.data
        // ====================================================

        if (
          !respostaCliente.data ||
          !respostaCliente.data.success ||
          !respostaCliente.data.data
        ) {
          adicionarLog(
            `Cliente não encontrado: ${cpf}`
          );

          processamento.erros++;

          processamento.processados = numeroAtual;

          enviarEstado();

          continue;
        }

        const cliente = respostaCliente.data.data;

        const clienteNome =
          cliente.name ||
          cliente.nome ||
          cliente.full_name ||
          "";

        const customerId =
          cliente.id ||
          cliente.customer_id;

        adicionarLog(
          `Cliente encontrado: ${clienteNome || "(sem nome)"}`
        );

        if (!customerId) {
          adicionarLog(
            `Cliente ${cpf} não possui customerId.`
          );

          processamento.erros++;

          processamento.processados = numeroAtual;

          enviarEstado();

          continue;
        }

        // ====================================================
        // BENEFÍCIOS DO CLIENTE
        // ====================================================

        const beneficios = Array.isArray(cliente.benefits)
          ? cliente.benefits
          : [];

        adicionarLog(
          `Cliente possui ${beneficios.length} benefício(s).`
        );

        const beneficioEncontrado =
          beneficios.find((item) => {
            const numeroAPI =
              somenteNumeros(
                item.registration_number
              );

            return numeroAPI === beneficioNumero;
          });

        if (!beneficioEncontrado) {
          adicionarLog(
            `Benefício ${beneficioNumero} não encontrado no cliente ${cpf}.`
          );

          processamento.erros++;

          processamento.processados = numeroAtual;

          enviarEstado();

          continue;
        }

        const benefitId =
          beneficioEncontrado.id ||
          beneficioEncontrado.benefit_id;

        if (!benefitId) {
          adicionarLog(
            `Benefício ${beneficioNumero} não possui ID.`
          );

          processamento.erros++;

          processamento.processados = numeroAtual;

          enviarEstado();

          continue;
        }

        adicionarLog(
          `Benefício encontrado. ID: ${benefitId}`
        );

        // ====================================================
        // IN100
        // ====================================================

        adicionarLog(
          `Consultando IN100: ${cpf} / ${beneficioNumero}`
        );

        let resultadoIN100;

        try {
          resultadoIN100 =
            await consultarIN100(
              cpf,
              beneficioNumero
            );
        } catch (erroIN100) {
          const statusHTTP =
            erroIN100.response?.status;

          const mensagem =
            erroIN100.response?.data?.message ||
            erroIN100.response?.data?.status?.message ||
            erroIN100.message ||
            "Erro IN100";

          // --------------------------------------------------
          // HTTP 400
          // --------------------------------------------------

          if (statusHTTP === 400) {
            const texto = String(
              mensagem
            ).toLowerCase();

            if (
              texto.includes(
                "bloqueado durante o processo de concessão"
              )
            ) {
              processamento.bloqueados++;
              processamento.bloqueadosConcessao++;

              processamento.atualizacoes.push({
                cpf,
                beneficio: beneficioNumero,
                statusAtual:
                  beneficioEncontrado.status,
                novoStatus: 3,
                resultado:
                  "BLOQUEADO_CONCESSAO",
                motivo:
                  "Benefício bloqueado durante o processo de concessão"
              });

              adicionarLog(
                `IN100: ${beneficioNumero} bloqueado durante concessão.`
              );

              processamento.processados =
                numeroAtual;

              enviarEstado();

              continue;
            }

            if (
              texto.includes(
                "bloqueado pelo beneficiário"
              )
            ) {
              processamento.bloqueados++;
              processamento.bloqueadosBeneficiario++;

              processamento.atualizacoes.push({
                cpf,
                beneficio: beneficioNumero,
                statusAtual:
                  beneficioEncontrado.status,
                novoStatus: 3,
                resultado:
                  "BLOQUEADO_BENEFICIARIO",
                motivo:
                  "Benefício bloqueado pelo beneficiário"
              });

              adicionarLog(
                `IN100: ${beneficioNumero} bloqueado pelo beneficiário.`
              );

              processamento.processados =
                numeroAtual;

              enviarEstado();

              continue;
            }

            if (
              texto.includes(
                "número do benefício inválido"
              ) ||
              texto.includes(
                "numero do beneficio invalido"
              )
            ) {
              processamento.beneficiosInvalidos++;

              processamento.atualizacoes.push({
                cpf,
                beneficio: beneficioNumero,
                statusAtual:
                  beneficioEncontrado.status,
                novoStatus: null,
                resultado:
                  "BENEFICIO_INVALIDO",
                motivo:
                  "Número do benefício inválido"
              });

              adicionarLog(
                `IN100: benefício ${beneficioNumero} inválido.`
              );

              processamento.processados =
                numeroAtual;

              enviarEstado();

              continue;
            }
          }

          // --------------------------------------------------
          // OUTRO ERRO
          // --------------------------------------------------

          processamento.erros++;

          adicionarLog(
            `Erro IN100 ${cpf}/${beneficioNumero}: ${mensagem}`
          );

          processamento.atualizacoes.push({
            cpf,
            beneficio: beneficioNumero,
            statusAtual:
              beneficioEncontrado.status,
            novoStatus: null,
            resultado: "ERRO_IN100",
            motivo: mensagem
          });

          processamento.processados =
            numeroAtual;

          enviarEstado();

          continue;
        }

        // ====================================================
        // INTERPRETA RESULTADO IN100
        // ====================================================

        let novoStatus = null;

        const blockType =
          resultadoIN100?.blockType;

        if (
          blockType === "not_blocked"
        ) {
          novoStatus = 1;

          processamento.desbloqueados++;
        } else if (
          blockType
        ) {
          novoStatus = 3;

          processamento.bloqueados++;
        } else {
          processamento.erros++;

          adicionarLog(
            `IN100 retornou blockType inesperado: ${blockType}`
          );

          processamento.processados =
            numeroAtual;

          enviarEstado();

          continue;
        }

        adicionarLog(
          `IN100 concluído: ${beneficioNumero} → ${novoStatus === 1 ? "DESBLOQUEADO" : "BLOQUEADO"}`
        );

        // ====================================================
        // MARGEM
        // ====================================================

        const margem =
          resultadoIN100?.consignedCreditBalance ??
          null;

        // ====================================================
        // REGISTRA ATUALIZAÇÃO
        // ====================================================

        processamento.atualizacoes.push({
          cpf,

          beneficio:
            beneficioNumero,

          statusAtual:
            beneficioEncontrado.status,

          novoStatus,

          resultado:
            novoStatus === 1
              ? "DESBLOQUEADO"
              : "BLOQUEADO",

          margem,

          customerId,

          benefitId
        });

        processamento.processados =
          numeroAtual;

        enviarEstado();

        // Pequeno intervalo entre consultas
        await esperar(1500);

      } catch (erro) {
        processamento.erros++;

        const mensagem =
          erro.response?.data?.message ||
          erro.response?.data?.status?.message ||
          erro.message ||
          "Erro desconhecido";

        adicionarLog(
          `Erro no processamento de ${cpf}/${beneficioNumero}: ${mensagem}`
        );

        processamento.processados =
          numeroAtual;

        enviarEstado();
      }
    }

    // ========================================================
    // AGUARDANDO CONFIRMAÇÃO
    // ========================================================

    processamento.executando = false;
    processamento.etapa = "aguardando_confirmacao";
    processamento.confirmado = false;

    processamento.fim =
      new Date().toISOString();

    adicionarLog(
      "Análise concluída. Aguardando confirmação para atualizar os benefícios."
    );

    enviarEstado();

  } catch (erro) {
    processamento.executando = false;
    processamento.etapa = "erro";

    processamento.fim =
      new Date().toISOString();

    processamento.erros++;

    adicionarLog(
      `ERRO GERAL: ${erro.message}`
    );

    enviarEstado();

    throw erro;
  }
}

// ============================================================
// POST PROCESSAR
// ============================================================

app.post(
  "/api/processar",
  upload.single("arquivo"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          erro: "Nenhum arquivo enviado."
        });
      }

      if (processamento.executando) {
        return res.status(409).json({
          erro:
            "Já existe um processamento em andamento."
        });
      }

      const corban =
        String(req.body.corban || "")
          .trim()
          .toUpperCase();

      if (!["IEV", "CS"].includes(corban)) {
        return res.status(400).json({
          erro: "Corban inválido. Use IEV ou CS."
        });
      }

      processamento.arquivo =
        req.file.originalname;

      // Executa sem bloquear a resposta HTTP
      processarArquivo(
        req.file.buffer,
        corban
      ).catch((erro) => {
        console.error(
          "Erro assíncrono no processamento:",
          erro
        );
      });

      return res.json({
        sucesso: true,
        mensagem:
          "Processamento iniciado.",
        arquivo:
          req.file.originalname
      });

    } catch (erro) {
      console.error(
        "Erro /api/processar:",
        erro
      );

      return res.status(500).json({
        erro:
          erro.message ||
          "Erro interno."
      });
    }
  }
);

// ============================================================
// POST CONFIRMAR
// ============================================================

app.post(
  "/api/confirmar",
  async (req, res) => {
    try {
      if (
        !processamento.atualizacoes ||
        processamento.atualizacoes.length === 0
      ) {
        return res.status(400).json({
          erro:
            "Não existem atualizações para confirmar."
        });
      }

      if (
        processamento.etapa !==
        "aguardando_confirmacao"
      ) {
        return res.status(400).json({
          erro:
            "O processamento não está aguardando confirmação."
        });
      }

      const corban =
        processamento.corban;

      const api = criarAPI(corban);

      processamento.executando = true;
      processamento.etapa =
        "atualizando";

      processamento.confirmado = false;

      // Conta somente registros que realmente
      // possuem novoStatus
      const atualizacoesValidas =
        processamento.atualizacoes.filter(
          (item) =>
            item.novoStatus === 1 ||
            item.novoStatus === 3
        );

      const totalAtualizacoes =
        atualizacoesValidas.length;

      let atualizadas = 0;

      adicionarLog(
        `Iniciando atualização de ${totalAtualizacoes} benefício(s).`
      );

      enviarEstado();

      for (
        let i = 0;
        i < atualizacoesValidas.length;
        i++
      ) {
        const item =
          atualizacoesValidas[i];

        try {
          adicionarLog(
            `Atualizando ${i + 1}/${totalAtualizacoes}: ${item.cpf} / ${item.beneficio}`
          );

          // ==================================================
          // PAYLOAD
          // ==================================================

          const payload = {
            status: item.novoStatus
          };

          await atualizarBeneficioComRetry(
            api,
            item.customerId,
            item.benefitId,
            payload
          );

          // ==================================================
          // VERIFICAÇÃO
          // ==================================================

          const respostaVerificacao =
            await buscarClienteComRetry(
              api,
              item.cpf
            );

          let confirmado = false;

          if (
            respostaVerificacao.data &&
            respostaVerificacao.data.success &&
            respostaVerificacao.data.data
          ) {
            const cliente =
              respostaVerificacao.data.data;

            const beneficios =
              Array.isArray(cliente.benefits)
                ? cliente.benefits
                : [];

            const beneficioVerificado =
              beneficios.find(
                (beneficio) =>
                  somenteNumeros(
                    beneficio.registration_number
                  ) ===
                  somenteNumeros(
                    item.beneficio
                  )
              );

            if (
              beneficioVerificado &&
              Number(
                beneficioVerificado.status
              ) ===
                Number(item.novoStatus)
            ) {
              confirmado = true;
            }
          }

          if (confirmado) {
            adicionarLog(
              `Atualização confirmada: ${item.beneficio}`
            );
          } else {
            adicionarLog(
              `PUT realizado, mas não foi possível confirmar o novo status de ${item.beneficio}.`
            );
          }

          atualizadas++;

          // Atualiza o registro local
          item.atualizado = confirmado;

          enviarEvento("atualizacao", {
            atual: atualizadas,
            total: totalAtualizacoes,
            cpf: item.cpf,
            beneficio: item.beneficio,
            sucesso: confirmado
          });

          enviarEstado();

          await esperar(1500);

        } catch (erro) {
          processamento.erros++;

          const mensagem =
            erro.response?.data?.message ||
            erro.response?.data?.status?.message ||
            erro.message ||
            "Erro desconhecido";

          adicionarLog(
            `Erro ao atualizar ${item.beneficio}: ${mensagem}`
          );

          item.atualizado = false;

          enviarEvento("atualizacao", {
            atual: atualizadas,
            total: totalAtualizacoes,
            cpf: item.cpf,
            beneficio: item.beneficio,
            sucesso: false,
            erro: mensagem
          });

          enviarEstado();
        }
      }

      processamento.executando = false;
      processamento.etapa =
        "concluido";

      processamento.confirmado = true;

      processamento.fim =
        new Date().toISOString();

      adicionarLog(
        "Todas as atualizações foram processadas."
      );

      enviarEstado();

      return res.json({
        sucesso: true,
        mensagem:
          "Atualizações concluídas.",
        total: totalAtualizacoes,
        processadas: atualizadas
      });

    } catch (erro) {
      processamento.executando = false;
      processamento.etapa = "erro";

      processamento.erros++;

      processamento.fim =
        new Date().toISOString();

      adicionarLog(
        `Erro na confirmação: ${erro.message}`
      );

      enviarEstado();

      return res.status(500).json({
        erro:
          erro.message ||
          "Erro ao confirmar atualizações."
      });
    }
  }
);

// ============================================================
// CANCELAR
// ============================================================

app.post(
  "/api/cancelar",
  (req, res) => {
    if (!processamento.executando) {
      return res.json({
        sucesso: true,
        mensagem:
          "Nenhum processamento em andamento."
      });
    }

    processamento.executando = false;
    processamento.etapa =
      "cancelado";

    processamento.fim =
      new Date().toISOString();

    adicionarLog(
      "Processamento cancelado."
    );

    enviarEstado();

    return res.json({
      sucesso: true,
      mensagem:
        "Processamento cancelado."
    });
  }
);

// ============================================================
// STATUS
// ============================================================

app.get(
  "/api/status",
  (req, res) => {
    res.json({
      executando:
        processamento.executando,

      etapa:
        processamento.etapa,

      corban:
        processamento.corban,

      total:
        processamento.total,

      processados:
        processamento.processados,

      desbloqueados:
        processamento.desbloqueados,

      bloqueados:
        processamento.bloqueados,

      bloqueadosConcessao:
        processamento.bloqueadosConcessao,

      bloqueadosBeneficiario:
        processamento.bloqueadosBeneficiario,

      beneficiosInvalidos:
        processamento.beneficiosInvalidos,

      erros:
        processamento.erros,

      atualizacoes:
        processamento.atualizacoes,

      confirmado:
        processamento.confirmado,

      arquivo:
        processamento.arquivo,

      inicio:
        processamento.inicio,

      fim:
        processamento.fim,

      logs:
        processamento.logs
    });
  }
);

// ============================================================
// HEALTH
// ============================================================

app.get(
  "/",
  (req, res) => {
    res.json({
      status: "online",
      sistema:
        "Atualização de Benefícios",
      in100: !!IN100_APIKEY,
      corbans: {
        IEV: true,
        CS: true
      }
    });
  }
);

// ============================================================
// SERVER
// ============================================================

app.listen(
  PORT,
  () => {
    console.log(
      `Servidor rodando na porta ${PORT}`
    );

    console.log(
      `IN100: ${IN100_BASE_URL}`
    );

    console.log(
      `IEV: ${NEW.IEV.BASE_URL}`
    );

    console.log(
      `CS: ${NEW.CS.BASE_URL}`
    );
  }
);
