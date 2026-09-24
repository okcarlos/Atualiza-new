require("dotenv").config();

const express = require("express");
const axios = require("axios");
const XLSX = require("xlsx");
const multer = require("multer");
const https = require("https");
const cors = require("cors");

// ============================================
// CONFIGURAÇÕES
// ============================================

const PORT = process.env.PORT || 3000;

// ============================================
// NEW CORBAN
// ============================================

const NEW = {

    IEV: {

        TOKEN:
            process.env.NEWCORBAN_IEV_TOKEN,

        BASE_URL:
            process.env.NEWCORBAN_IEV_BASE_URL
    },

    CS: {

        TOKEN:
            process.env.NEWCORBAN_CS_TOKEN,

        BASE_URL:
            process.env.NEWCORBAN_CS_BASE_URL
    }
};

// ============================================
// IN100
// ============================================

const IN100_APIKEY =
    process.env.IN100_APIKEY;

const IN100_BASE_URL =
    process.env.IN100_BASE_URL ||
    "https://integration.ajin.io";

const STATUS = {

    DESBLOQUEADO: 1,

    BLOQUEADO: 3
};

const INTERVALO_ENTRE_CONSULTAS = 1500;

const INTERVALO_ENTRE_PUTS = 1500;

const IN100_LAST_HOURS = 1;

const IN100_TIMEOUT = 120;

// ============================================
// VALIDAÇÕES
// ============================================

if (
    !NEW.IEV.TOKEN ||
    !NEW.IEV.BASE_URL
) {

    console.error(
        "❌ Credenciais do New Corban IEV não configuradas."
    );

    process.exit(1);
}

if (
    !NEW.CS.TOKEN ||
    !NEW.CS.BASE_URL
) {

    console.error(
        "❌ Credenciais do New Corban CS não configuradas."
    );

    process.exit(1);
}

if (!IN100_APIKEY) {

    console.error(
        "❌ IN100_APIKEY não configurado."
    );

    process.exit(1);
}

// ============================================
// EXPRESS
// ============================================

const app = express();

// ============================================
// CORS
// ============================================

// Temporariamente liberado para testar.
// Depois podemos restringir somente ao GitHub Pages.

app.use(
    cors({
        origin: true,
        methods: [
            "GET",
            "POST",
            "PUT",
            "OPTIONS"
        ],
        allowedHeaders: [
            "Content-Type",
            "Authorization"
        ]
    })
);

app.use(
    express.json()
);

app.use(
    express.urlencoded({
        extended: true
    })
);

// ============================================
// UPLOAD
// ============================================

const upload = multer({

    storage:
        multer.memoryStorage(),

    limits: {

        fileSize:
            10 * 1024 * 1024
    }
});

// ============================================
// CRIAR API NEW CORBAN
// ============================================

function criarAPI(corban) {

    const configuracao =
        NEW[corban];

    if (!configuracao) {

        throw new Error(
            `New Corban inválido: ${corban}`
        );
    }

    return axios.create({

        baseURL:
            configuracao.BASE_URL,

        headers: {

            "Content-Type":
                "application/json",

            "Accept":
                "application/json",

            "Authorization":
                `Bearer ${configuracao.TOKEN}`
        },

        timeout: 15000
    });
}

// ============================================
// API IN100
// ============================================

const apiIN100 = axios.create({

    baseURL:
        IN100_BASE_URL,

    headers: {

        "Content-Type":
            "application/json",

        "Accept":
            "application/json",

        "apikey":
            IN100_APIKEY
    },

    httpsAgent:
        new https.Agent({

            family: 4,

            keepAlive: true
        }),

    timeout: 180000
});

// ============================================
// ESTADO
// ============================================

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

    errosDetalhes: [],

    logs: [],

    arquivo: null,

    confirmado: false
};

// ============================================
// SSE
// ============================================

const clientesSSE =
    new Set();

function enviarEvento(
    tipo,
    dados = {}
) {

    const mensagem = {

        tipo,

        ...dados
    };

    const texto =
        `data: ${JSON.stringify(mensagem)}\n\n`;

    for (
        const cliente of clientesSSE
    ) {

        try {

            if (
                cliente.writableEnded
            ) {

                clientesSSE.delete(
                    cliente
                );

                continue;
            }

            cliente.write(
                texto
            );

        } catch {

            clientesSSE.delete(
                cliente
            );

            try {
                cliente.end();
            } catch {}
        }
    }
}

// ============================================
// LOG
// ============================================

function log(
    mensagem,
    tipo = "info"
) {

    const item = {

        hora:
            new Date()
                .toLocaleTimeString(
                    "pt-BR"
                ),

        mensagem,

        tipo
    };

    processamento.logs.push(
        item
    );

    if (
        processamento.logs.length >
        100
    ) {

        processamento.logs.shift();
    }

    enviarEvento(
        "log",
        item
    );
}

// ============================================
// ESTADO
// ============================================

function enviarEstado() {

    enviarEvento(
        "estado",
        {

            executando:
                processamento.executando,

            etapa:
                processamento.etapa,

            corban:
                processamento.corban,

            newCorban:
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
                processamento.atualizacoes.map(
                    item => ({

                        cpf:
                            item.cpf,

                        cliente:
                            item.cliente,

                        beneficio:
                            item.beneficio,

                        statusAtual:
                            item.statusAtual,

                        novoStatus:
                            item.novoStatus,

                        statusNome:
                            item.statusNome,

                        in100Status:
                            item.in100Status,

                        blockType:
                            item.blockType,

                        blockCategory:
                            item.blockCategory,

                        benefitStatus:
                            item.benefitStatus,

                        benefitSituation:
                            item.benefitSituation,

                        mensagemIN100:
                            item.mensagemIN100,

                        resultado:
                            item.resultado ||
                            null
                    })
                ),

            errosDetalhes:
                processamento.errosDetalhes
        }
    );
}

// ============================================
// UTILIDADES
// ============================================

function esperar(ms) {

    return new Promise(
        resolve => {

            setTimeout(
                resolve,
                ms
            );
        }
    );
}

function limparCPF(cpf) {

    return String(
        cpf ?? ""
    )
        .replace(
            /\D/g,
            ""
        );
}

function normalizarTexto(valor) {

    return String(
        valor ?? ""
    )
        .trim()
        .toUpperCase();
}

// ============================================
// STATUS
// ============================================

function nomeStatus(codigo) {

    if (
        codigo ===
        STATUS.BLOQUEADO
    ) {

        return "BLOQUEADO";
    }

    if (
        codigo ===
        STATUS.DESBLOQUEADO
    ) {

        return "DESBLOQUEADO";
    }

    return "DESCONHECIDO";
}

// ============================================
// CLASSIFICAÇÃO IN100
// ============================================

function classificarBloqueioIN100(
    mensagem
) {

    const texto =
        String(
            mensagem ?? ""
        )
            .trim()
            .toLowerCase();

    if (
        texto.includes(
            "benefício bloqueado durante o processo de concessão"
        )
    ) {

        return {

            blockType:
                "blocked_during_concession",

            blockCategory:
                "CONCESSAO",

            status:
                STATUS.BLOQUEADO,

            deveAtualizar:
                true
        };
    }

    if (
        texto.includes(
            "benefício bloqueado pelo beneficiário"
        )
    ) {

        return {

            blockType:
                "blocked_by_beneficiary",

            blockCategory:
                "BENEFICIARIO",

            status:
                STATUS.BLOQUEADO,

            deveAtualizar:
                true
        };
    }

    if (
        texto.includes(
            "número do benefício inválido"
        )
    ) {

        return {

            blockType:
                "invalid_benefit_number",

            blockCategory:
                "BENEFICIO_INVALIDO",

            status:
                null,

            deveAtualizar:
                false
        };
    }

    return null;
}

// ============================================
// CONVERTER IN100
// ============================================

function converterIN100ParaStatus(
    resposta
) {

    if (!resposta) {
        return null;
    }

    const blockType =
        String(
            resposta.blockType ?? ""
        )
            .trim()
            .toLowerCase();

    if (
        blockType ===
        "not_blocked"
    ) {

        return STATUS.DESBLOQUEADO;
    }

    if (
        blockType !== ""
    ) {

        return STATUS.BLOQUEADO;
    }

    return null;
}

// ============================================
// LER PLANILHA
// ============================================

function lerPlanilha(buffer) {

    const workbook =
        XLSX.read(
            buffer,
            {
                type: "buffer"
            }
        );

    const nomePlanilha =
        workbook.SheetNames[0];

    const worksheet =
        workbook.Sheets[
            nomePlanilha
        ];

    const dados =
        XLSX.utils.sheet_to_json(
            worksheet,
            {
                defval: ""
            }
        );

    return dados.map(
        linha => {

            const novaLinha = {};

            for (
                const chave in linha
            ) {

                novaLinha[
                    normalizarTexto(
                        chave
                    )
                ] =
                    linha[chave];
            }

            return novaLinha;
        }
    );
}

// ============================================
// DUPLICATAS
// ============================================

function removerDuplicados(
    linhas
) {

    const vistos =
        new Set();

    const resultado = [];

    for (
        const linha of linhas
    ) {

        const cpf =
            limparCPF(
                linha.CPF
            );

        const beneficio =
            normalizarTexto(
                linha.BENEFICIO
            );

        const chave =
            `${cpf}|${beneficio}`;

        if (
            vistos.has(chave)
        ) {

            continue;
        }

        vistos.add(chave);

        resultado.push(
            linha
        );
    }

    return resultado;
}

// ============================================
// AGRUPAR CPF
// ============================================

function agruparPorCPF(
    linhas
) {

    const grupos =
        new Map();

    for (
        const linha of linhas
    ) {

        const cpf =
            limparCPF(
                linha.CPF
            );

        if (
            !grupos.has(cpf)
        ) {

            grupos.set(
                cpf,
                []
            );
        }

        grupos
            .get(cpf)
            .push(linha);
    }

    return grupos;
}

// ============================================
// GET CLIENTE
// ============================================

async function buscarClienteComRetry(
    api,
    cpf
) {

    const MAX_TENTATIVAS = 6;

    for (
        let tentativa = 1;
        tentativa <= MAX_TENTATIVAS;
        tentativa++
    ) {

        try {

            return await api.get(
                `/customers/cpf/${cpf}`
            );

        } catch (error) {

            if (
                error.response &&
                error.response.status === 429
            ) {

                await esperar(
                    800 * tentativa
                );

                continue;
            }

            throw error;
        }
    }

    throw new Error(
        "Limite de requisições atingido."
    );
}

// ============================================
// PUT
// ============================================

async function atualizarBeneficioComRetry(
    api,
    customerId,
    benefitId,
    dados
) {

    const MAX_TENTATIVAS = 6;

    for (
        let tentativa = 1;
        tentativa <= MAX_TENTATIVAS;
        tentativa++
    ) {

        try {

            return await api.put(

                `/customers/${customerId}/benefits/${benefitId}`,

                dados
            );

        } catch (error) {

            if (
                error.response &&
                error.response.status === 429
            ) {

                await esperar(
                    800 * tentativa
                );

                continue;
            }

            throw error;
        }
    }

    throw new Error(
        "PUT bloqueado por limite de requisições."
    );
}

// ============================================
// CONSULTAR IN100
// ============================================

async function consultarIN100(
    cpf,
    beneficio
) {

    try {

        const resposta =
            await apiIN100.post(

                "/v3/query-inss-balances/finder/await",

                {

                    identity:
                        cpf,

                    benefitNumber:
                        beneficio,

                    lastHours:
                        IN100_LAST_HOURS,

                    timeout:
                        IN100_TIMEOUT
                }
            );

        const resultado =
            resposta.data;

        if (
            resultado?.status?.key ===
            "success"
        ) {

            return resultado;
        }

        if (
            resultado?.status?.key ===
            "error"
        ) {

            throw new Error(
                resultado.status?.note ||
                "Consulta IN100 retornou erro."
            );
        }

        throw new Error(
            `Status IN100 inesperado: ${
                resultado?.status?.key ||
                "desconhecido"
            }`
        );

    } catch (error) {

        if (
            error.response &&
            error.response.status === 400
        ) {

            const dados =
                error.response.data;

            const mensagem =
                dados?.messages?.[0]?.text ||
                "";

            const classificacao =
                classificarBloqueioIN100(
                    mensagem
                );

            if (
                classificacao
            ) {

                return {

                    bloqueado:
                        classificacao.status ===
                        STATUS.BLOQUEADO,

                    invalido:
                        classificacao.blockCategory ===
                        "BENEFICIO_INVALIDO",

                    deveAtualizar:
                        classificacao.deveAtualizar,

                    status: {

                        key:
                            classificacao.status ===
                            STATUS.BLOQUEADO
                                ? "blocked"
                                : "invalid",

                        name:
                            classificacao.blockCategory
                    },

                    blockType:
                        classificacao.blockType,

                    blockCategory:
                        classificacao.blockCategory,

                    benefitStatus:
                        null,

                    benefitSituation:
                        null,

                    mensagem
                };
            }
        }

        const detalhe =
            error.response
                ? `HTTP ${error.response.status}`
                : error.message;

        throw new Error(
            `Erro ao consultar IN100: ${detalhe}`
        );
    }
}

// ============================================
// MONTAR PUT
// ============================================

function montarDadosPUT(
    beneficio,
    novoStatus
) {

    return {

        registration_number:
            beneficio.registration_number,

        benefit_species:
            beneficio.benefit_species,

        covenant_id:
            beneficio.covenant_id,

        state:
            beneficio.state,

        benefit_status:
            novoStatus,

        benefit_dispatch_date:
            beneficio.benefit_dispatch_date
                ? beneficio
                    .benefit_dispatch_date
                    .substring(0, 10)
                : null,

        unblock_date:
            beneficio.unblock_date
                ? beneficio
                    .unblock_date
                    .substring(0, 10)
                : null,

        margin:
            beneficio.margin,

        card_margin:
            beneficio.card_margin,

        calculation_base:
            beneficio.calculation_base
    };
}

// ============================================
// ERRO
// ============================================

function adicionarErro(
    cpf,
    beneficio,
    detalhe,
    categoria = null
) {

    processamento.erros++;

    const erro = {

        cpf,

        beneficio,

        detalhe,

        categoria
    };

    processamento
        .errosDetalhes
        .push(erro);

    log(
        `${cpf} | ${beneficio || "-"} — ${detalhe}`,
        "error"
    );
}

// ============================================
// PROCESSAR PLANILHA
// ============================================

async function processarPlanilha(
    buffer,
    nomeArquivo,
    corban
) {

    if (
        processamento.executando
    ) {

        throw new Error(
            "Já existe um processamento em andamento."
        );
    }

    const api =
        criarAPI(corban);

    processamento = {

        executando: true,

        etapa: "consultando",

        corban,

        total: 0,

        processados: 0,

        desbloqueados: 0,

        bloqueados: 0,

        bloqueadosConcessao: 0,

        bloqueadosBeneficiario: 0,

        beneficiosInvalidos: 0,

        erros: 0,

        atualizacoes: [],

        errosDetalhes: [],

        logs: [],

        arquivo: nomeArquivo,

        confirmado: false
    };

    enviarEstado();

    log(
        `Planilha recebida: ${nomeArquivo}`
    );

    log(
        `New Corban selecionado: ${corban}`
    );

    let linhas;

    try {

        linhas =
            lerPlanilha(
                buffer
            );

    } catch (error) {

        processamento.executando =
            false;

        processamento.etapa =
            "erro";

        throw new Error(
            `Erro ao ler planilha: ${error.message}`
        );
    }

    if (
        !linhas.length
    ) {

        processamento.executando =
            false;

        processamento.etapa =
            "erro";

        throw new Error(
            "A planilha está vazia."
        );
    }

    const colunas =
        Object.keys(
            linhas[0]
        );

    if (
        !colunas.includes("CPF") ||
        !colunas.includes("BENEFICIO")
    ) {

        processamento.executando =
            false;

        processamento.etapa =
            "erro";

        throw new Error(
            "A planilha precisa possuir as colunas CPF e BENEFICIO."
        );
    }

    const linhasOriginais =
        linhas.length;

    linhas =
        removerDuplicados(
            linhas
        );

    log(
        `${linhas.length} benefício(s) para processar.`
    );

    if (
        linhasOriginais !==
        linhas.length
    ) {

        log(
            `${linhasOriginais - linhas.length} duplicata(s) removida(s).`
        );
    }

    processamento.total =
        linhas.length;

    const grupos =
        agruparPorCPF(
            linhas
        );

    for (
        const [
            cpf,
            linhasCliente
        ]
        of grupos
    ) {

        if (
            !processamento.executando
        ) {

            break;
        }

        if (
            cpf.length !== 11
        ) {

            for (
                const linha
                of linhasCliente
            ) {

                adicionarErro(
                    cpf,
                    linha.BENEFICIO,
                    "CPF inválido",
                    "CPF_INVALIDO"
                );

                processamento.processados++;

                enviarEstado();
            }

            continue;
        }

        let respostaCliente;

        try {

            respostaCliente =
                await buscarClienteComRetry(
                    api,
                    cpf
                );

        } catch (error) {

            const detalhe =
                error.response
                    ? `HTTP ${error.response.status}`
                    : error.message;

            for (
                const linha
                of linhasCliente
            ) {

                adicionarErro(
                    cpf,
                    linha.BENEFICIO,
                    `Erro no New Corban: ${detalhe}`,
                    "NEW_CORBAN"
                );

                processamento.processados++;

                enviarEstado();
            }

            continue;
        }

        if (
            !respostaCliente.data ||
            !respostaCliente.data.success ||
            !respostaCliente.data.data
        ) {

            for (
                const linha
                of linhasCliente
            ) {

                adicionarErro(
                    cpf,
                    linha.BENEFICIO,
                    "Cliente não encontrado",
                    "CLIENTE_NAO_ENCONTRADO"
                );

                processamento.processados++;

                enviarEstado();
            }

            continue;
        }

        const cliente =
            respostaCliente.data.data;

        for (
            const linha
            of linhasCliente
        ) {

            const beneficioNumero =
                normalizarTexto(
                    linha.BENEFICIO
                );

            if (
                !beneficioNumero
            ) {

                adicionarErro(
                    cpf,
                    "",
                    "Benefício não informado",
                    "BENEFICIO_NAO_INFORMADO"
                );

                processamento.processados++;

                enviarEstado();

                continue;
            }

            const beneficios =
                cliente.benefits ||
                [];

            const beneficio =
                beneficios.find(
                    item =>
                        normalizarTexto(
                            item.registration_number
                        ) ===
                        beneficioNumero
                );

            if (
                !beneficio
            ) {

                adicionarErro(
                    cpf,
                    beneficioNumero,
                    "Benefício não encontrado no Corban",
                    "BENEFICIO_NAO_ENCONTRADO"
                );

                processamento.processados++;

                enviarEstado();

                continue;
            }

            log(
                `Consultando IN100: ${cpf} / ${beneficioNumero}`
            );

            let resultadoIN100;

            try {

                resultadoIN100 =
                    await consultarIN100(
                        cpf,
                        beneficioNumero
                    );

            } catch (error) {

                adicionarErro(
                    cpf,
                    beneficioNumero,
                    error.message,
                    "IN100"
                );

                processamento.processados++;

                enviarEstado();

                continue;
            }

            if (
                resultadoIN100.invalido ===
                true
            ) {

                processamento
                    .beneficiosInvalidos++;

                adicionarErro(
                    cpf,
                    beneficioNumero,
                    resultadoIN100.mensagem ||
                    "Número do benefício inválido",
                    "BENEFICIO_INVALIDO"
                );

                processamento.processados++;

                log(
                    `${cpf} | ${beneficioNumero} — BENEFÍCIO INVÁLIDO. Nenhum PUT será realizado.`,
                    "warning"
                );

                enviarEstado();

                continue;
            }

            let novoStatus;

            if (
                resultadoIN100.bloqueado ===
                true
            ) {

                novoStatus =
                    STATUS.BLOQUEADO;

            } else {

                novoStatus =
                    converterIN100ParaStatus(
                        resultadoIN100
                    );
            }

            if (
                novoStatus ===
                null
            ) {

                adicionarErro(
                    cpf,
                    beneficioNumero,
                    "Não foi possível determinar o status pela IN100",
                    "STATUS_IN100"
                );

                processamento.processados++;

                enviarEstado();

                continue;
            }

            if (
                resultadoIN100.blockCategory ===
                "CONCESSAO"
            ) {

                processamento
                    .bloqueadosConcessao++;
            }

            if (
                resultadoIN100.blockCategory ===
                "BENEFICIARIO"
            ) {

                processamento
                    .bloqueadosBeneficiario++;
            }

            if (
                beneficio.benefit_status ===
                novoStatus
            ) {

                log(
                    `${cpf} | ${beneficioNumero} — já está como ${nomeStatus(novoStatus)}. Nenhuma alteração necessária.`,
                    "info"
                );

                processamento.processados++;

                enviarEstado();

                continue;
            }

            const item = {

                cpf,

                cliente:
                    cliente.name,

                customerId:
                    cliente.id,

                beneficio:
                    beneficio.registration_number,

                benefitId:
                    beneficio.id,

                statusAtual:
                    beneficio.benefit_status,

                novoStatus,

                statusNome:
                    nomeStatus(
                        novoStatus
                    ),

                in100Status:
                    resultadoIN100
                        .status?.key,

                blockType:
                    resultadoIN100
                        .blockType,

                blockCategory:
                    resultadoIN100
                        .blockCategory,

                benefitStatus:
                    resultadoIN100
                        .benefitStatus,

                benefitSituation:
                    resultadoIN100
                        .benefitSituation,

                mensagemIN100:
                    resultadoIN100
                        .mensagem,

                dadosPUT:
                    montarDadosPUT(
                        beneficio,
                        novoStatus
                    ),

                resultado:
                    null
            };

            processamento
                .atualizacoes
                .push(item);

            if (
                novoStatus ===
                STATUS.DESBLOQUEADO
            ) {

                processamento
                    .desbloqueados++;

            } else if (
                novoStatus ===
                STATUS.BLOQUEADO
            ) {

                processamento
                    .bloqueados++;
            }

            processamento.processados++;

            let mensagemLog =
                `${cpf} | ${beneficioNumero} → ${nomeStatus(novoStatus)}`;

            if (
                resultadoIN100.blockCategory
            ) {

                mensagemLog +=
                    ` | ${resultadoIN100.blockCategory}`;
            }

            log(
                mensagemLog,
                novoStatus ===
                STATUS.BLOQUEADO
                    ? "blocked"
                    : "success"
            );

            enviarEstado();

            await esperar(
                INTERVALO_ENTRE_CONSULTAS
            );
        }
    }

    processamento.executando =
        false;

    processamento.etapa =
        "aguardando_confirmacao";

    log(
        `Análise concluída: ${processamento.atualizacoes.length} atualização(ões) preparada(s).`,
        "success"
    );

    log(
        `Resumo: ${processamento.desbloqueados} desbloqueado(s), ${processamento.bloqueados} bloqueado(s), ${processamento.bloqueadosConcessao} bloqueio(s) por concessão, ${processamento.bloqueadosBeneficiario} bloqueio(s) pelo beneficiário, ${processamento.beneficiosInvalidos} benefício(s) inválido(s).`,
        "info"
    );

    enviarEstado();
}

// ============================================
// EXECUTAR PUTS
// ============================================

async function executarAtualizacoes() {

    if (
        processamento.executando
    ) {

        throw new Error(
            "Já existe uma operação em andamento."
        );
    }

    if (
        processamento.etapa !==
        "aguardando_confirmacao"
    ) {

        throw new Error(
            "Não existe um lote aguardando confirmação."
        );
    }

    if (
        !processamento.atualizacoes.length
    ) {

        throw new Error(
            "Nenhuma atualização para executar."
        );
    }

    const api =
        criarAPI(
            processamento.corban
        );

    processamento.executando =
        true;

    processamento.etapa =
        "atualizando";

    enviarEstado();

    log(
        `Iniciando ${processamento.atualizacoes.length} PUT(s) no New Corban ${processamento.corban}...`
    );

    for (
        let i = 0;
        i < processamento.atualizacoes.length;
        i++
    ) {

        const item =
            processamento
                .atualizacoes[i];

        if (
            !processamento.executando
        ) {

            break;
        }

        enviarEvento(
            "progresso_put",
            {

                atual:
                    i + 1,

                total:
                    processamento
                        .atualizacoes
                        .length,

                cpf:
                    item.cpf,

                beneficio:
                    item.beneficio
            }
        );

        try {

            await atualizarBeneficioComRetry(

                api,

                item.customerId,

                item.benefitId,

                item.dadosPUT
            );

            log(
                `${item.cpf} | ${item.beneficio} — PUT realizado → status ${item.novoStatus}`,
                "success"
            );

            await esperar(1000);

            let verificado =
                false;

            try {

                const verificacao =
                    await buscarClienteComRetry(
                        api,
                        item.cpf
                    );

                const clienteAtualizado =
                    verificacao
                        .data
                        .data;

                const beneficioAtualizado =
                    (
                        clienteAtualizado
                            .benefits ||
                        []
                    ).find(
                        beneficio =>
                            normalizarTexto(
                                beneficio
                                    .registration_number
                            ) ===
                            item.beneficio
                    );

                if (
                    beneficioAtualizado &&
                    beneficioAtualizado
                        .benefit_status ===
                    item.novoStatus
                ) {

                    verificado =
                        true;
                }

            } catch {

                verificado =
                    false;
            }

            item.resultado =
                verificado
                    ? "SUCESSO"
                    : "PUT REALIZADO - NÃO CONFIRMADO";

            log(
                verificado
                    ? `${item.cpf} | ${item.beneficio} — atualização confirmada`
                    : `${item.cpf} | ${item.beneficio} — PUT realizado, mas não confirmado`,
                verificado
                    ? "success"
                    : "warning"
            );

        } catch (error) {

            const detalhe =
                error.response
                    ? `HTTP ${error.response.status}`
                    : error.message;

            item.resultado =
                "ERRO";

            item.detalhe =
                detalhe;

            log(
                `${item.cpf} | ${item.beneficio} — Erro no PUT: ${detalhe}`,
                "error"
            );
        }

        enviarEstado();

        await esperar(
            INTERVALO_ENTRE_PUTS
        );
    }

    processamento.executando =
        false;

    processamento.etapa =
        "finalizado";

    log(
        "Lote finalizado.",
        "success"
    );

    enviarEstado();
}

// ============================================
// SSE
// ============================================

app.get(
    "/api/events",
    (req, res) => {

        res.writeHead(
            200,
            {

                "Content-Type":
                    "text/event-stream",

                "Cache-Control":
                    "no-cache, no-transform",

                "Connection":
                    "keep-alive",

                "X-Accel-Buffering":
                    "no",

                "Access-Control-Allow-Origin":
                    "*"
            }
        );

        res.write(
            ": conectado\n\n"
        );

        clientesSSE.add(
            res
        );

        enviarEvento(
            "estado",
            {
                ...processamento,
                newCorban:
                    processamento.corban
            }
        );

        const heartbeat =
            setInterval(
                () => {

                    try {

                        res.write(
                            ": heartbeat\n\n"
                        );

                    } catch {

                        clearInterval(
                            heartbeat
                        );

                        clientesSSE.delete(
                            res
                        );
                    }

                },
                15000
            );

        req.on(
            "close",
            () => {

                clearInterval(
                    heartbeat
                );

                clientesSSE.delete(
                    res
                );

                try {
                    res.end();
                } catch {}
            }
        );
    }
);

// ============================================
// STATUS
// ============================================

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

            newCorban:
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
                processamento
                    .bloqueadosConcessao,

            bloqueadosBeneficiario:
                processamento
                    .bloqueadosBeneficiario,

            beneficiosInvalidos:
                processamento
                    .beneficiosInvalidos,

            erros:
                processamento.erros,

            atualizacoes:
                processamento
                    .atualizacoes,

            errosDetalhes:
                processamento
                    .errosDetalhes,

            logs:
                processamento.logs
        });
    }
);

// ============================================
// INICIAR
// ============================================

app.post(
    "/api/processar",
    upload.single("arquivo"),
    async (req, res) => {

        try {

            console.log(
                "📥 POST /api/processar"
            );

            console.log(
                "Arquivo:",
                req.file?.originalname
            );

            console.log(
                "Corban recebido:",
                req.body.corban
            );

            if (!req.file) {

                return res
                    .status(400)
                    .json({

                        sucesso: false,

                        erro:
                            "Nenhuma planilha enviada."
                    });
            }

            const corban =
                normalizarTexto(
                    req.body.corban
                );

            if (
                corban !== "IEV" &&
                corban !== "CS"
            ) {

                console.error(
                    "❌ Corban inválido:",
                    req.body.corban
                );

                return res
                    .status(400)
                    .json({

                        sucesso: false,

                        erro:
                            "Selecione um New Corban válido: IEV ou CS."
                    });
            }

            if (
                processamento.executando
            ) {

                return res
                    .status(409)
                    .json({

                        sucesso: false,

                        erro:
                            "Já existe um processamento em andamento."
                    });
            }

            res.json({

                sucesso: true,

                newCorban:
                    corban,

                mensagem:
                    `Processamento iniciado no New Corban ${corban}.`
            });

            processarPlanilha(

                req.file.buffer,

                req.file.originalname,

                corban

            ).catch(
                error => {

                    processamento
                        .executando =
                        false;

                    processamento.etapa =
                        "erro";

                    log(
                        error.message,
                        "error"
                    );

                    enviarEstado();
                }
            );

        } catch (error) {

            console.error(
                "❌ Erro /api/processar:",
                error
            );

            res
                .status(500)
                .json({

                    sucesso: false,

                    erro:
                        error.message
                });
        }
    }
);

// ============================================
// CONFIRMAR
// ============================================

app.post(
    "/api/confirmar",
    async (req, res) => {

        try {

            if (
                processamento.executando
            ) {

                return res
                    .status(409)
                    .json({

                        sucesso: false,

                        erro:
                            "Ainda existe processamento em andamento."
                    });
            }

            if (
                processamento.etapa !==
                "aguardando_confirmacao"
            ) {

                return res
                    .status(400)
                    .json({

                        sucesso: false,

                        erro:
                            "Não existe lote aguardando confirmação."
                    });
            }

            res.json({

                sucesso: true,

                newCorban:
                    processamento.corban,

                mensagem:
                    "Atualizações iniciadas."
            });

            executarAtualizacoes()
                .catch(
                    error => {

                        processamento
                            .executando =
                            false;

                        processamento.etapa =
                            "erro";

                        log(
                            error.message,
                            "error"
                        );

                        enviarEstado();
                    }
                );

        } catch (error) {

            res
                .status(500)
                .json({

                    sucesso: false,

                    erro:
                        error.message
                });
        }
    }
);

// ============================================
// CANCELAR
// ============================================

app.post(
    "/api/cancelar",
    (req, res) => {

        if (
            !processamento.executando
        ) {

            processamento.etapa =
                "cancelado";

            enviarEstado();

            return res.json({
                sucesso: true
            });
        }

        processamento.executando =
            false;

        processamento.etapa =
            "cancelado";

        log(
            "Processamento cancelado pelo usuário.",
            "warning"
        );

        enviarEstado();

        res.json({
            sucesso: true
        });
    }
);

// ============================================
// HEALTH CHECK
// ============================================

app.get(
    "/",
    (req, res) => {

        res.json({

            online: true,

            servidor:
                "Atualiza New Corban",

            status:
                processamento.etapa,

            corban:
                processamento.corban
        });
    }
);

// ============================================
// SERVIDOR
// ============================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `🚀 Servidor iniciado na porta ${PORT}`
        );

        console.log(
            `IEV: ${NEW.IEV.BASE_URL}`
        );

        console.log(
            `CS: ${NEW.CS.BASE_URL}`
        );

        console.log(
            `IN100: ${IN100_BASE_URL}`
        );
    }
);
