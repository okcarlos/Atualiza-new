// ============================================
// CONFIGURAÇÃO DO BACKEND
// ============================================

const BACKEND_URL =
    "https://atualiza-new-5346.onrender.com";

// ============================================
// ELEMENTOS
// ============================================

const arquivoInput =
    document.getElementById("arquivo");

const nomeArquivo =
    document.getElementById("nomeArquivo");

const newCorban =
    document.getElementById("newCorban");

const btnIniciar =
    document.getElementById("btnIniciar");

const btnCancelar =
    document.getElementById("btnCancelar");

const btnLimparLogs =
    document.getElementById("btnLimparLogs");

const statusSistema =
    document.getElementById("statusSistema");

const statusTexto =
    document.getElementById("statusTexto");

const total =
    document.getElementById("total");

const processados =
    document.getElementById("processados");

const desbloqueados =
    document.getElementById("desbloqueados");

const bloqueados =
    document.getElementById("bloqueados");

const erros =
    document.getElementById("erros");

const etapa =
    document.getElementById("etapa");

const porcentagem =
    document.getElementById("porcentagem");

const barraProgresso =
    document.getElementById("barraProgresso");

const tabela =
    document.getElementById("tabela");

const logs =
    document.getElementById("logs");

const modal =
    document.getElementById("modal");

const modalDesbloqueados =
    document.getElementById("modalDesbloqueados");

const modalBloqueados =
    document.getElementById("modalBloqueados");

const modalErros =
    document.getElementById("modalErros");

const btnFecharModal =
    document.getElementById("btnFecharModal");

const btnConfirmar =
    document.getElementById("btnConfirmar");


// ============================================
// ARQUIVO
// ============================================

arquivoInput.addEventListener(
    "change",
    () => {

        const arquivo =
            arquivoInput.files[0];

        if (!arquivo) {

            nomeArquivo.textContent =
                "Nenhum arquivo selecionado";

            return;
        }

        nomeArquivo.textContent =
            arquivo.name;
    }
);


// ============================================
// INICIAR
// ============================================

btnIniciar.addEventListener(
    "click",
    async () => {

        const arquivo =
            arquivoInput.files[0];

        if (!arquivo) {

            adicionarLog(
                "Selecione uma planilha primeiro.",
                "warning"
            );

            return;
        }

        // ========================================
        // VALIDAR NEW CORBAN
        // ========================================

        if (!newCorban || !newCorban.value) {

            adicionarLog(
                "Selecione qual New Corban será utilizado.",
                "warning"
            );

            return;
        }

        limparTela();

        btnIniciar.disabled = true;
        btnCancelar.disabled = false;

        alterarStatus(
            "executando",
            "Processando"
        );

        etapa.textContent =
            "Analisando planilha...";

        const formData =
            new FormData();

        formData.append(
            "arquivo",
            arquivo
        );

        // ========================================
        // ENVIA A ESCOLHA DO NEW CORBAN
        // ========================================

        formData.append(
            "newCorban",
            newCorban.value
        );

        try {

            const resposta =
                await fetch(
                    `${BACKEND_URL}/api/processar`,
                    {
                        method: "POST",
                        body: formData
                    }
                );

            const dados =
                await resposta.json();

            if (!resposta.ok) {

                throw new Error(
                    dados.erro ||
                    "Erro ao iniciar processamento."
                );
            }

        } catch (error) {

            adicionarLog(
                error.message,
                "error"
            );

            btnIniciar.disabled = false;
            btnCancelar.disabled = true;

            alterarStatus(
                "erro",
                "Erro"
            );
        }
    }
);


// ============================================
// CANCELAR
// ============================================

btnCancelar.addEventListener(
    "click",
    async () => {

        try {

            await fetch(
                `${BACKEND_URL}/api/cancelar`,
                {
                    method: "POST"
                }
            );

        } catch (error) {

            adicionarLog(
                "Erro ao cancelar.",
                "error"
            );
        }
    }
);


// ============================================
// MODAL
// ============================================

btnFecharModal.addEventListener(
    "click",
    () => {

        modal.classList.add(
            "escondido"
        );
    }
);


btnConfirmar.addEventListener(
    "click",
    async () => {

        btnConfirmar.disabled = true;
        btnFecharModal.disabled = true;

        modal.classList.add(
            "escondido"
        );

        try {

            const resposta =
                await fetch(
                    `${BACKEND_URL}/api/confirmar`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body:
                            JSON.stringify({
                                confirmar: true
                            })
                    }
                );

            const dados =
                await resposta.json();

            if (!resposta.ok) {

                throw new Error(
                    dados.erro ||
                    "Erro ao confirmar."
                );
            }

            alterarStatus(
                "executando",
                "Atualizando"
            );

            etapa.textContent =
                "Enviando atualizações...";

            btnCancelar.disabled =
                false;

        } catch (error) {

            adicionarLog(
                error.message,
                "error"
            );

            btnConfirmar.disabled =
                false;

            btnFecharModal.disabled =
                false;
        }
    }
);


// ============================================
// LIMPAR LOGS
// ============================================

btnLimparLogs.addEventListener(
    "click",
    () => {

        logs.innerHTML = "";

        delete logs.dataset.erros;
    }
);


// ============================================
// SSE
// ============================================

const eventos =
    new EventSource(
        `${BACKEND_URL}/api/events`
    );

eventos.onopen = () => {

    console.log(
        "SSE conectado."
    );
};

eventos.onerror = () => {

    console.warn(
        "Conexão SSE perdida. O navegador tentará reconectar."
    );
};

eventos.onmessage =
    event => {

        try {

            const dados =
                JSON.parse(
                    event.data
                );

            processarEvento(
                dados
            );

        } catch {
            // Ignora evento inválido
        }
    };


// ============================================
// PROCESSAR EVENTOS
// ============================================

function processarEvento(
    dados
) {

    if (
        dados.tipo === "estado"
    ) {

        atualizarInterface(
            dados
        );

        return;
    }

    if (
        dados.tipo === "log"
    ) {

        adicionarLog(
            dados.mensagem,
            dados.tipo
        );

        return;
    }

    if (
        dados.tipo === "progresso_put"
    ) {

        etapa.textContent =
            `Atualizando ${dados.atual}/${dados.total}`;

        return;
    }
}


// ============================================
// ATUALIZAR INTERFACE
// ============================================

function atualizarInterface(
    dados
) {

    total.textContent =
        dados.total ?? 0;

    processados.textContent =
        dados.processados ?? 0;

    desbloqueados.textContent =
        dados.desbloqueados ?? 0;

    bloqueados.textContent =
        dados.bloqueados ?? 0;

    erros.textContent =
        dados.erros ?? 0;


    // ========================================
    // PROGRESSO
    // ========================================

    const totalItens =
        Number(
            dados.total || 0
        );

    const processadosItens =
        Number(
            dados.processados || 0
        );

    let porcentagemAtual = 0;

    if (
        totalItens > 0
    ) {

        porcentagemAtual =
            Math.round(
                (
                    processadosItens /
                    totalItens
                ) * 100
            );
    }

    porcentagem.textContent =
        `${porcentagemAtual}%`;

    barraProgresso.style.width =
        `${porcentagemAtual}%`;


    // ========================================
    // ETAPA
    // ========================================

    if (
        dados.etapa ===
        "consultando"
    ) {

        etapa.textContent =
            `Consultando ${processadosItens}/${totalItens}`;

        alterarStatus(
            "executando",
            "Processando"
        );

    } else if (
        dados.etapa ===
        "aguardando_confirmacao"
    ) {

        etapa.textContent =
            "Análise concluída — aguardando confirmação";

        alterarStatus(
            "pronto",
            "Aguardando confirmação"
        );

        btnIniciar.disabled =
            false;

        btnCancelar.disabled =
            true;

        mostrarModal(
            dados
        );

    } else if (
        dados.etapa ===
        "atualizando"
    ) {

        alterarStatus(
            "executando",
            "Atualizando"
        );

        btnIniciar.disabled =
            true;

        btnCancelar.disabled =
            false;

    } else if (
        dados.etapa ===
        "finalizado"
    ) {

        etapa.textContent =
            "Lote finalizado";

        alterarStatus(
            "pronto",
            "Finalizado"
        );

        btnIniciar.disabled =
            false;

        btnCancelar.disabled =
            true;

    } else if (
        dados.etapa ===
        "cancelado"
    ) {

        etapa.textContent =
            "Operação cancelada";

        alterarStatus(
            "parado",
            "Cancelado"
        );

        btnIniciar.disabled =
            false;

        btnCancelar.disabled =
            true;

    } else if (
        dados.etapa ===
        "erro"
    ) {

        alterarStatus(
            "erro",
            "Erro"
        );

        btnIniciar.disabled =
            false;

        btnCancelar.disabled =
            true;
    }


    // ========================================
    // TABELA
    // ========================================

    renderizarTabela(
        dados.atualizacoes || []
    );


    // ========================================
    // ERROS DETALHADOS
    // ========================================

    renderizarErros(
        dados.errosDetalhes || []
    );
}


// ============================================
// STATUS
// ============================================

function alterarStatus(
    classe,
    texto
) {

    statusSistema.className =
        `status-indicator ${classe}`;

    statusTexto.textContent =
        texto;
}


// ============================================
// TABELA
// ============================================

function renderizarTabela(
    itens
) {

    if (!itens.length) {

        tabela.innerHTML = `
            <tr class="vazio">
                <td colspan="6">
                    Nenhum benefício processado.
                </td>
            </tr>
        `;

        return;
    }

    tabela.innerHTML =
        itens.map(
            item => {

                const statusAtual =
                    statusBadge(
                        item.statusAtual
                    );

                const novoStatus =
                    item.novoStatus === 1
                        ? `<span class="badge badge-verde">
                            DESBLOQUEADO
                           </span>`
                        : `<span class="badge badge-vermelho">
                            BLOQUEADO
                           </span>`;

                const in100 =
                    item.blockType ===
                    "not_blocked"

                        ? `<span class="badge badge-verde">
                            not_blocked
                           </span>`

                        : item.blockType
                            ? `<span class="badge badge-vermelho">
                                ${escapeHTML(
                                item.blockType
                            )}
                               </span>`

                            : `<span class="badge badge-amarelo">
                                -
                               </span>`;

                const resultado =
                    resultadoBadge(
                        item.resultado
                    );

                return `
                    <tr>

                        <td>
                            ${formatarCPF(item.cpf)}
                        </td>

                        <td>
                            ${escapeHTML(
                    item.beneficio
                )}
                        </td>

                        <td>
                            ${statusAtual}
                        </td>

                        <td>
                            ${in100}
                        </td>

                        <td>
                            ${novoStatus}
                        </td>

                        <td>
                            ${resultado}
                        </td>

                    </tr>
                `;
            }
        ).join("");
}


// ============================================
// BADGE STATUS
// ============================================

function statusBadge(
    status
) {

    if (
        status === 1
    ) {

        return `
            <span class="badge badge-verde">
                1 — DESBLOQUEADO
            </span>
        `;
    }

    if (
        status === 3
    ) {

        return `
            <span class="badge badge-vermelho">
                3 — BLOQUEADO
            </span>
        `;
    }

    return `
        <span class="badge badge-amarelo">
            ${escapeHTML(
        String(status ?? "-")
    )}
        </span>
    `;
}


// ============================================
// RESULTADO
// ============================================

function resultadoBadge(
    resultado
) {

    if (
        resultado === "SUCESSO"
    ) {

        return `
            <span class="badge badge-verde">
                ✓ Confirmado
            </span>
        `;
    }

    if (
        resultado ===
        "PUT REALIZADO - NÃO CONFIRMADO"
    ) {

        return `
            <span class="badge badge-amarelo">
                ⚠ Não confirmado
            </span>
        `;
    }

    if (
        resultado === "ERRO"
    ) {

        return `
            <span class="badge badge-vermelho">
                ✕ Erro
            </span>
        `;
    }

    return `
        <span class="badge badge-amarelo">
            Aguardando
        </span>
    `;
}


// ============================================
// MODAL
// ============================================

function mostrarModal(
    dados
) {

    modalDesbloqueados.textContent =
        dados.desbloqueados ?? 0;

    modalBloqueados.textContent =
        dados.bloqueados ?? 0;

    modalErros.textContent =
        dados.erros ?? 0;

    btnConfirmar.disabled =
        false;

    btnFecharModal.disabled =
        false;

    modal.classList.remove(
        "escondido"
    );
}


// ============================================
// LOG
// ============================================

function adicionarLog(
    mensagem,
    tipo = "info"
) {

    const div =
        document.createElement(
            "div"
        );

    div.className =
        `log log-${tipo}`;

    const hora =
        new Date().toLocaleTimeString(
            "pt-BR"
        );

    div.innerHTML = `
        <span class="log-hora">
            ${hora}
        </span>

        <span>
            ${escapeHTML(mensagem)}
        </span>
    `;

    logs.appendChild(
        div
    );

    logs.scrollTop =
        logs.scrollHeight;
}


// ============================================
// ERROS DETALHADOS
// ============================================

function renderizarErros(
    lista
) {

    if (!Array.isArray(lista)) {
        return;
    }

    /*
     * Evita recriar os erros toda vez que
     * chegar um evento SSE.
     */

    const errosAtuais =
        JSON.stringify(lista);

    if (
        logs.dataset.erros ===
        errosAtuais
    ) {

        return;
    }

    logs.dataset.erros =
        errosAtuais;


    /*
     * Remove somente os erros detalhados
     * adicionados anteriormente.
     */

    const errosExistentes =
        logs.querySelectorAll(
            ".log-erro-detalhado"
        );

    errosExistentes.forEach(
        elemento =>
            elemento.remove()
    );


    lista.forEach(
        erro => {

            const div =
                document.createElement(
                    "div"
                );

            div.className =
                "log log-error log-erro-detalhado";


            const hora =
                new Date().toLocaleTimeString(
                    "pt-BR"
                );


            const cpf =
                formatarCPF(
                    erro.cpf
                );


            const beneficio =
                erro.beneficio
                    ? escapeHTML(
                        erro.beneficio
                    )
                    : "-";


            const detalhe =
                escapeHTML(
                    erro.detalhe ||
                    "Motivo não informado."
                );


            div.innerHTML = `
                <span class="log-hora">
                    ${hora}
                </span>

                <span>
                    ❌ <strong>Erro</strong>
                    — CPF: ${cpf}
                    — Benefício: ${beneficio}
                    — ${detalhe}
                </span>
            `;


            logs.appendChild(
                div
            );
        }
    );


    logs.scrollTop =
        logs.scrollHeight;
}


// ============================================
// LIMPAR TELA
// ============================================

function limparTela() {

    total.textContent =
        "0";

    processados.textContent =
        "0";

    desbloqueados.textContent =
        "0";

    bloqueados.textContent =
        "0";

    erros.textContent =
        "0";

    porcentagem.textContent =
        "0%";

    barraProgresso.style.width =
        "0%";

    tabela.innerHTML = `
        <tr class="vazio">
            <td colspan="6">
                Nenhum benefício processado.
            </td>
        </tr>
    `;

    logs.innerHTML =
        "";

    delete logs.dataset.erros;
}


// ============================================
// FORMATAR CPF
// ============================================

function formatarCPF(
    cpf
) {

    const valor =
        String(cpf ?? "")
            .replace(/\D/g, "");

    if (
        valor.length !== 11
    ) {

        return escapeHTML(
            valor
        );
    }

    return (
        valor.substring(0, 3) +
        "." +
        valor.substring(3, 6) +
        "." +
        valor.substring(6, 9) +
        "-" +
        valor.substring(9, 11)
    );
}


// ============================================
// SEGURANÇA
// ============================================

function escapeHTML(
    valor
) {

    return String(valor ?? "")
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );
}