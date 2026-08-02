(() => {
  "use strict";

  const STORAGE_KEY = "gamebook-reader-state-v1";
  const LIBRARY_KEY = "gamebook-reader-library-v2";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const STATUS_LABELS = {
    none: "无标记",
    important: "重要",
    clue: "线索",
    danger: "危险",
    done: "已完成"
  };

  const defaultState = () => ({
    version: 2,
    offset: 0,
    currentPdfPage: 1,
    currentNodeId: null,
    selectedNodeId: null,
    pdfName: "",
    savedAt: null,
    sidebarCollapsed: false,
    nodes: {},
    history: []
  });

  let library = loadLibrary();
  let state = loadState();
  let pdfDocument = null;
  let pdfLoadingTask = null;
  let pdfRenderTask = null;
  let pdfRenderToken = 0;
  let zoomFactor = 1;
  let resizeTimer = null;
  let toastTimer = null;
  let undoAction = null;
  let editingChoiceId = null;
  let graphScale = 1;

  const $ = (id) => document.getElementById(id);
  const els = {
    workspace: document.querySelector(".workspace"), pdfInput: $("pdfInput"), importInput: $("importInput"),
    pdfViewport: $("pdfViewport"), pdfCanvas: $("pdfCanvas"), pdfEmpty: $("pdfEmpty"), pdfLoading: $("pdfLoading"), pdfLoadingText: $("pdfLoadingText"),
    pdfStage: $("pdfStage"), bookName: $("bookName"), autosaveStatus: $("autosaveStatus"), currentPdfPage: $("currentPdfPage"), totalPdfPages: $("totalPdfPages"),
    offsetInput: $("offsetInput"), jumpForm: $("jumpForm"), jumpInput: $("jumpInput"),
    previousPageButton: $("previousPageButton"), nextPageButton: $("nextPageButton"), backButton: $("backButton"),
    zoomOutButton: $("zoomOutButton"), zoomInButton: $("zoomInButton"), zoomLabel: $("zoomLabel"),
    sidebarToggleButton: $("sidebarToggleButton"), fullscreenButton: $("fullscreenButton"), moreButton: $("moreButton"), moreMenu: $("moreMenu"),
    exportButton: $("exportButton"), resetButton: $("resetButton"),
    noCurrentNode: $("noCurrentNode"), currentNodeContent: $("currentNodeContent"),
    currentNodeTitle: $("currentNodeTitle"), currentNodeStatus: $("currentNodeStatus"), currentNodeMeta: $("currentNodeMeta"),
    currentNodeTags: $("currentNodeTags"), currentNodeNote: $("currentNodeNote"), editCurrentNodeButton: $("editCurrentNodeButton"), jumpSelectedNodeButton: $("jumpSelectedNodeButton"),
    nodeMoreButton: $("nodeMoreButton"), nodeActionMenu: $("nodeActionMenu"), deleteSelectedNodeButton: $("deleteSelectedNodeButton"),
    choiceList: $("choiceList"), choiceForm: $("choiceForm"), addChoiceButton: $("addChoiceButton"),
    choiceLabel: $("choiceLabel"), choiceTarget: $("choiceTarget"), cancelChoiceButton: $("cancelChoiceButton"), saveChoiceButton: $("saveChoiceButton"),
    addNodeButton: $("addNodeButton"), openGraphButton: $("openGraphButton"), nodeCount: $("nodeCount"), nodeSearch: $("nodeSearch"), nodeList: $("nodeList"),
    historyCount: $("historyCount"), historyList: $("historyList"),
    nodeDialog: $("nodeDialog"), nodeForm: $("nodeForm"), nodeDialogTitle: $("nodeDialogTitle"), editingNodeId: $("editingNodeId"),
    nodeIdInput: $("nodeIdInput"), nodeTitleInput: $("nodeTitleInput"), bookPageInput: $("bookPageInput"),
    nodePdfPageInput: $("nodePdfPageInput"), nodeStatusInput: $("nodeStatusInput"), nodeTagsInput: $("nodeTagsInput"),
    nodeNoteInput: $("nodeNoteInput"), nodeFormError: $("nodeFormError"), deleteNodeButton: $("deleteNodeButton"),
    closeNodeDialogButton: $("closeNodeDialogButton"), cancelNodeButton: $("cancelNodeButton"),
    graphDialog: $("graphDialog"), graphViewport: $("graphViewport"), graphSvg: $("graphSvg"), graphEmpty: $("graphEmpty"),
    graphSelectionLabel: $("graphSelectionLabel"), graphJumpButton: $("graphJumpButton"), graphZoomOutButton: $("graphZoomOutButton"),
    graphZoomInButton: $("graphZoomInButton"), graphFitButton: $("graphFitButton"), closeGraphButton: $("closeGraphButton"),
    toast: $("toast"), toastMessage: $("toastMessage"), toastAction: $("toastAction")
  };

  function loadLibrary() {
    try {
      const saved = JSON.parse(localStorage.getItem(LIBRARY_KEY));
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch {
      return {};
    }
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      const normalized = normalizeState(saved);
      if (normalized.pdfName && !library[normalized.pdfName]) {
        library[normalized.pdfName] = normalized;
        localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
      }
      return normalized;
    } catch {
      return defaultState();
    }
  }

  function normalizeState(value) {
    const base = defaultState();
    if (!value || typeof value !== "object") return base;
    base.offset = asInteger(value.offset, 0);
    base.currentPdfPage = positiveInteger(value.currentPdfPage, 1);
    base.currentNodeId = value.currentNodeId == null ? null : String(value.currentNodeId);
    base.selectedNodeId = value.selectedNodeId == null ? base.currentNodeId : String(value.selectedNodeId);
    base.pdfName = typeof value.pdfName === "string" ? value.pdfName : "";
    base.savedAt = Number.isFinite(Number(value.savedAt)) ? Number(value.savedAt) : null;
    base.sidebarCollapsed = Boolean(value.sidebarCollapsed);
    base.history = Array.isArray(value.history) ? value.history.slice(-100).map((item) => ({
      nodeId: item.nodeId == null ? null : String(item.nodeId),
      pdfPage: positiveInteger(item.pdfPage, 1),
      label: typeof item.label === "string" ? item.label : "阅读位置"
    })) : [];
    if (value.nodes && typeof value.nodes === "object") {
      for (const rawNode of Object.values(value.nodes)) {
        if (!rawNode || rawNode.id == null) continue;
        const id = String(rawNode.id).trim();
        if (!id) continue;
        base.nodes[id] = {
          id,
          title: stringValue(rawNode.title),
          bookPage: optionalPositiveInteger(rawNode.bookPage),
          pdfPage: optionalPositiveInteger(rawNode.pdfPage),
          status: STATUS_LABELS[rawNode.status] ? rawNode.status : "none",
          tags: stringValue(rawNode.tags),
          note: stringValue(rawNode.note),
          choices: Array.isArray(rawNode.choices) ? rawNode.choices.map((choice) => ({
            id: stringValue(choice.id) || uid(),
            label: stringValue(choice.label) || "前往",
            targetNodeId: String(choice.targetNodeId ?? "")
          })).filter((choice) => choice.targetNodeId) : []
        };
      }
    }
    if (base.currentNodeId && !base.nodes[base.currentNodeId]) base.currentNodeId = null;
    if (base.selectedNodeId && !base.nodes[base.selectedNodeId]) base.selectedNodeId = base.currentNodeId;
    return base;
  }

  function saveState() {
    try {
      state.savedAt = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (state.pdfName) {
        library[state.pdfName] = JSON.parse(JSON.stringify(state));
        localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
      }
      updateAutosaveStatus();
    } catch {
      showToast("无法保存数据，请检查浏览器的本地存储设置");
    }
  }

  function stringValue(value) { return typeof value === "string" ? value : ""; }
  function asInteger(value, fallback) { const n = Number(value); return Number.isInteger(n) ? n : fallback; }
  function positiveInteger(value, fallback) { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : fallback; }
  function optionalPositiveInteger(value) { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; }
  function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
  function currentNode() { return state.currentNodeId ? state.nodes[state.currentNodeId] || null : null; }
  function selectedNode() { return state.selectedNodeId ? state.nodes[state.selectedNodeId] || null : null; }
  function nodeLabel(node) { return node.title ? `${node.id} · ${node.title}` : `节点 ${node.id}`; }
  function resolveNodePage(node) {
    if (node.pdfPage) return node.pdfPage;
    if (node.bookPage) return Math.max(1, node.bookPage + state.offset);
    const numericId = Number(node.id);
    return Number.isInteger(numericId) && numericId > 0 ? Math.max(1, numericId + state.offset) : 1;
  }

  function pushCurrentToHistory() {
    const node = currentNode();
    const latest = state.history[state.history.length - 1];
    const entry = { nodeId: state.currentNodeId, pdfPage: state.currentPdfPage, label: node ? nodeLabel(node) : `PDF 第 ${state.currentPdfPage} 页` };
    if (!latest || latest.nodeId !== entry.nodeId || latest.pdfPage !== entry.pdfPage) {
      state.history.push(entry);
      state.history = state.history.slice(-100);
    }
  }

  function navigateToPage(page, options = {}) {
    const targetPage = positiveInteger(page, 0);
    if (!targetPage) {
      showToast("页码必须是大于 0 的整数");
      return;
    }
    if (pdfDocument && targetPage > pdfDocument.numPages) {
      showToast(`这份 PDF 只有 ${pdfDocument.numPages} 页`);
      return;
    }
    if (options.record !== false && targetPage !== state.currentPdfPage) pushCurrentToHistory();
    state.currentPdfPage = targetPage;
    state.currentNodeId = options.nodeId == null ? null : String(options.nodeId);
    if (options.nodeId != null) state.selectedNodeId = String(options.nodeId);
    saveState();
    updatePdfFrame();
    render();
  }

  function navigateToNode(id, options = {}) {
    const node = state.nodes[String(id)];
    if (!node) {
      showToast(`找不到节点 ${id}`);
      return;
    }
    navigateToPage(resolveNodePage(node), { nodeId: node.id, record: options.record });
  }

  function selectNode(id) {
    const node = state.nodes[String(id)];
    if (!node) return;
    state.selectedNodeId = node.id;
    saveState();
    renderCurrentNode();
    renderNodeList();
    if (els.graphDialog.open) renderGraph();
  }

  function updatePdfFrame() {
    els.currentPdfPage.textContent = String(state.currentPdfPage);
    if (pdfDocument) renderPdfPage();
  }

  function showPdfLoading(message) {
    els.pdfLoadingText.textContent = message;
    els.pdfLoading.hidden = false;
  }

  function hidePdfLoading() {
    els.pdfLoading.hidden = true;
  }

  async function renderPdfPage() {
    if (!pdfDocument) return;
    const token = ++pdfRenderToken;
    const pageNumber = Math.min(Math.max(1, state.currentPdfPage), pdfDocument.numPages);
    if (pageNumber !== state.currentPdfPage) {
      state.currentPdfPage = pageNumber;
      saveState();
    }
    if (pdfRenderTask) {
      pdfRenderTask.cancel();
      pdfRenderTask = null;
    }
    showPdfLoading(`正在显示第 ${pageNumber} 页…`);
    try {
      const page = await pdfDocument.getPage(pageNumber);
      if (token !== pdfRenderToken) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(120, els.pdfViewport.clientWidth - 24);
      const availableHeight = Math.max(120, els.pdfViewport.clientHeight - 24);
      const fitScale = Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height);
      const viewport = page.getViewport({ scale: Math.max(0.05, fitScale * zoomFactor) });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = els.pdfCanvas;
      const context = canvas.getContext("2d", { alpha: false });
      canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
      canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.setAttribute("aria-label", `PDF 第 ${pageNumber} 页，共 ${pdfDocument.numPages} 页`);
      pdfRenderTask = page.render({
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
        background: "#ffffff"
      });
      await pdfRenderTask.promise;
      if (token === pdfRenderToken) hidePdfLoading();
    } catch (error) {
      if (error?.name === "RenderingCancelledException") return;
      console.error(error);
      hidePdfLoading();
      showToast("这一页无法显示，请尝试重新选择 PDF");
    } finally {
      if (token === pdfRenderToken) pdfRenderTask = null;
    }
  }

  async function handlePdfFile(file) {
    if (!file) return;
    if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      showToast("请选择 PDF 文件");
      return;
    }
    if (!window.pdfjsLib) {
      showToast("PDF 渲染组件没有加载，请重新打开工具");
      return;
    }
    showPdfLoading("正在读取 PDF…");
    try {
      saveState();
      if (pdfLoadingTask) await pdfLoadingTask.destroy();
      if (pdfDocument) await pdfDocument.destroy();
      const data = new Uint8Array(await file.arrayBuffer());
      pdfLoadingTask = window.pdfjsLib.getDocument({ data, isEvalSupported: false });
      pdfDocument = await pdfLoadingTask.promise;
      pdfLoadingTask = null;
      const hadSavedBookmarks = Boolean(library[file.name]);
      state = hadSavedBookmarks ? normalizeState(library[file.name]) : defaultState();
      state.pdfName = file.name;
      state.currentPdfPage = Math.min(state.currentPdfPage, pdfDocument.numPages);
      saveState();
      els.pdfEmpty.hidden = true;
      els.pdfViewport.hidden = false;
      els.totalPdfPages.textContent = String(pdfDocument.numPages);
      zoomFactor = 1;
      updateZoomControls();
      render();
      await renderPdfPage();
      const bookmarkMessage = hadSavedBookmarks
        ? `已自动加载 ${Object.keys(state.nodes).length} 个同名书签`
        : "已为这份 PDF 创建同名书签数据";
      showToast(`${bookmarkMessage} · 共 ${pdfDocument.numPages} 页`);
    } catch (error) {
      console.error(error);
      pdfDocument = null;
      pdfLoadingTask = null;
      els.pdfViewport.hidden = true;
      els.pdfEmpty.hidden = false;
      els.totalPdfPages.textContent = "—";
      hidePdfLoading();
      showToast("无法读取这份 PDF，请确认文件没有损坏或加密");
    } finally {
      els.pdfInput.value = "";
    }
  }

  function updateZoomControls() {
    els.zoomLabel.textContent = zoomFactor === 1 ? "适合" : `${Math.round(zoomFactor * 100)}%`;
    els.zoomOutButton.disabled = !pdfDocument || zoomFactor <= 0.5;
    els.zoomInButton.disabled = !pdfDocument || zoomFactor >= 3;
  }

  function changeZoom(delta) {
    if (!pdfDocument) return;
    zoomFactor = Math.min(3, Math.max(0.5, Math.round((zoomFactor + delta) * 100) / 100));
    updateZoomControls();
    renderPdfPage();
  }

  function renderLayout() {
    els.workspace.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
    els.sidebarToggleButton.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
    els.sidebarToggleButton.setAttribute("aria-label", state.sidebarCollapsed ? "展开节点侧栏" : "收起节点侧栏");
    els.sidebarToggleButton.title = state.sidebarCollapsed ? "展开节点侧栏" : "收起节点侧栏";
  }

  function render() {
    renderHeader();
    renderCurrentNode();
    renderNodeList();
    renderHistory();
    renderLayout();
    updateZoomControls();
    els.offsetInput.value = String(state.offset);
    els.currentPdfPage.textContent = String(state.currentPdfPage);
    els.backButton.disabled = state.history.length === 0;
    els.previousPageButton.disabled = !pdfDocument || state.currentPdfPage <= 1;
    els.nextPageButton.disabled = !pdfDocument || state.currentPdfPage >= pdfDocument.numPages;
  }

  function renderHeader() {
    if (pdfDocument) els.bookName.textContent = state.pdfName;
    else if (state.pdfName) els.bookName.textContent = `${state.pdfName}（请重新选择文件）`;
    else els.bookName.textContent = "尚未选择 PDF";
    updateAutosaveStatus();
  }

  function updateAutosaveStatus() {
    if (!els?.autosaveStatus) return;
    if (!state.pdfName) {
      els.autosaveStatus.textContent = "等待选择";
      return;
    }
    if (!state.savedAt) {
      els.autosaveStatus.textContent = "同名书签已就绪";
      return;
    }
    const time = new Date(state.savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    els.autosaveStatus.textContent = `已自动保存 ${time}`;
  }

  function renderCurrentNode() {
    const node = selectedNode();
    closeNodeActionMenu();
    els.noCurrentNode.hidden = Boolean(node);
    els.currentNodeContent.hidden = !node;
    els.jumpSelectedNodeButton.disabled = !node || !pdfDocument;
    if (!node) return;
    els.currentNodeTitle.textContent = node.title || `节点 ${node.id}`;
    els.currentNodeStatus.textContent = STATUS_LABELS[node.status];
    els.currentNodeStatus.dataset.status = node.status;
    const bookText = node.bookPage ? `书中第 ${node.bookPage} 页` : "未设置书中页码";
    const pageSource = node.pdfPage ? "固定" : "偏移计算";
    const readingText = node.id === state.currentNodeId ? " · 正在阅读" : "";
    els.currentNodeMeta.textContent = `编号 ${node.id} · ${bookText} · PDF 第 ${resolveNodePage(node)} 页（${pageSource}）${readingText}`;
    els.jumpSelectedNodeButton.disabled = !pdfDocument || (node.id === state.currentNodeId && resolveNodePage(node) === state.currentPdfPage);
    els.currentNodeTags.textContent = node.tags ? node.tags.split(",").map((tag) => `#${tag.trim()}`).filter((tag) => tag !== "#").join("  ") : "";
    els.currentNodeNote.textContent = node.note;
    renderChoices(node);
  }

  function renderChoices(node) {
    els.choiceList.replaceChildren();
    if (!node.choices.length) {
      const empty = document.createElement("p");
      empty.className = "choice-empty";
      empty.textContent = "还没有跳转关系。";
      els.choiceList.append(empty);
    }
    for (const choice of node.choices) {
      const target = state.nodes[choice.targetNodeId];
      const row = document.createElement("div");
      row.className = "choice-row";
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "choice-jump";
      jump.disabled = !target;
      const label = document.createElement("strong");
      label.textContent = choice.label;
      const meta = document.createElement("span");
      meta.textContent = target ? `前往 ${nodeLabel(target)} · PDF ${resolveNodePage(target)}` : `目标节点 ${choice.targetNodeId} 已不存在`;
      jump.append(label, meta);
      jump.addEventListener("click", () => navigateToNode(choice.targetNodeId));
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "choice-edit";
      edit.setAttribute("aria-label", `编辑关系：${choice.label}`);
      edit.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m14 7 3 3"/></svg>';
      edit.addEventListener("click", () => openChoiceForm(choice));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "choice-delete";
      remove.setAttribute("aria-label", `删除关系：${choice.label}`);
      remove.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M8 7l1 13h6l1-13M10 11v5M14 11v5"/></svg>';
      remove.addEventListener("click", () => {
        node.choices = node.choices.filter((item) => item.id !== choice.id);
        saveState();
        renderCurrentNode();
        showToast("跳转关系已删除");
      });
      row.append(jump, edit, remove);
      els.choiceList.append(row);
    }
  }

  function sortedNodes() {
    return Object.values(state.nodes).sort((a, b) => a.id.localeCompare(b.id, "zh-CN", { numeric: true }));
  }

  function renderNodeList() {
    const nodes = sortedNodes();
    const query = els.nodeSearch.value.trim().toLocaleLowerCase();
    const visible = query ? nodes.filter((node) => [node.id, node.title, node.tags, node.note, STATUS_LABELS[node.status]].join(" ").toLocaleLowerCase().includes(query)) : nodes;
    els.nodeCount.textContent = `${nodes.length} 个节点`;
    els.nodeList.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "empty-list";
      empty.textContent = nodes.length ? "没有匹配的节点" : "还没有节点，先添加一个吧";
      els.nodeList.append(empty);
      return;
    }
    for (const node of visible) {
      const row = document.createElement("div");
      row.className = "node-item-row";
      if (node.id === state.currentNodeId) row.classList.add("is-reading");
      const item = document.createElement("button");
      item.type = "button";
      item.className = "node-item";
      item.setAttribute("aria-selected", String(node.id === state.selectedNodeId));
      if (node.id === state.currentNodeId) item.setAttribute("aria-current", "true");
      const number = document.createElement("span");
      number.className = "node-number";
      number.textContent = node.id;
      const copy = document.createElement("span");
      copy.className = "node-copy";
      const title = document.createElement("strong");
      title.textContent = node.title || `节点 ${node.id}`;
      const detail = document.createElement("span");
      const reading = node.id === state.currentNodeId ? "正在阅读 · " : "";
      const marker = node.status !== "none" ? `${STATUS_LABELS[node.status]} · ` : "";
      detail.textContent = `${reading}${marker}${node.tags || "无文本标签"}`;
      copy.append(title, detail);
      const page = document.createElement("span");
      page.className = "node-page";
      page.textContent = `PDF ${resolveNodePage(node)}`;
      item.append(number, copy, page);
      item.addEventListener("click", () => selectNode(node.id));
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "node-jump-button";
      jump.textContent = "跳转";
      jump.setAttribute("aria-label", `跳转到${nodeLabel(node)}，PDF 第 ${resolveNodePage(node)} 页`);
      jump.disabled = !pdfDocument;
      jump.addEventListener("click", () => navigateToNode(node.id));
      row.append(item, jump);
      els.nodeList.append(row);
    }
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  }

  function graphLayout(nodes) {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const incoming = Object.fromEntries(nodes.map((node) => [node.id, 0]));
    for (const node of nodes) {
      for (const choice of node.choices) if (nodeIds.has(choice.targetNodeId)) incoming[choice.targetNodeId] += 1;
    }
    const roots = nodes.filter((node) => incoming[node.id] === 0);
    const orderedSeeds = [...roots, ...nodes.filter((node) => !roots.includes(node))];
    const levels = new Map();
    for (const seed of orderedSeeds) {
      if (levels.has(seed.id)) continue;
      levels.set(seed.id, roots.includes(seed) ? 0 : Math.max(0, ...levels.values()) + 1);
      const queue = [seed];
      while (queue.length) {
        const source = queue.shift();
        const sourceLevel = levels.get(source.id);
        for (const choice of source.choices) {
          if (!nodeIds.has(choice.targetNodeId) || levels.has(choice.targetNodeId)) continue;
          levels.set(choice.targetNodeId, sourceLevel + 1);
          queue.push(state.nodes[choice.targetNodeId]);
        }
      }
    }
    const columns = new Map();
    for (const node of nodes) {
      const level = levels.get(node.id) || 0;
      if (!columns.has(level)) columns.set(level, []);
      columns.get(level).push(node);
    }
    const positions = new Map();
    const nodeWidth = 176;
    const nodeHeight = 66;
    const horizontalGap = 92;
    const verticalGap = 34;
    const margin = 52;
    let maxRows = 1;
    for (const [level, column] of columns) {
      maxRows = Math.max(maxRows, column.length);
      column.forEach((node, index) => positions.set(node.id, {
        x: margin + level * (nodeWidth + horizontalGap),
        y: margin + index * (nodeHeight + verticalGap)
      }));
    }
    const maxLevel = Math.max(0, ...columns.keys());
    return {
      positions, nodeWidth, nodeHeight,
      width: margin * 2 + (maxLevel + 1) * nodeWidth + maxLevel * horizontalGap,
      height: margin * 2 + maxRows * nodeHeight + (maxRows - 1) * verticalGap
    };
  }

  function renderGraph() {
    const nodes = sortedNodes();
    els.graphSvg.replaceChildren();
    els.graphEmpty.hidden = nodes.length > 0;
    els.graphSvg.hidden = nodes.length === 0;
    const selected = selectedNode();
    els.graphSelectionLabel.textContent = selected ? `已选中：${nodeLabel(selected)} · PDF ${resolveNodePage(selected)}` : "尚未选中节点";
    els.graphJumpButton.disabled = !selected || !pdfDocument;
    if (!nodes.length) return;

    const layout = graphLayout(nodes);
    els.graphSvg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
    els.graphSvg.style.width = `${Math.round(layout.width * graphScale)}px`;
    els.graphSvg.style.height = `${Math.round(layout.height * graphScale)}px`;

    const defs = svgElement("defs");
    const marker = svgElement("marker", { id: "graphArrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
    marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "graph-arrow" }));
    defs.append(marker);
    els.graphSvg.append(defs);

    const edges = svgElement("g", { class: "graph-edges" });
    for (const source of nodes) {
      const start = layout.positions.get(source.id);
      for (const choice of source.choices) {
        const target = state.nodes[choice.targetNodeId];
        const end = target ? layout.positions.get(target.id) : null;
        if (!end) continue;
        const x1 = start.x + layout.nodeWidth;
        const y1 = start.y + layout.nodeHeight / 2;
        const x2 = end.x;
        const y2 = end.y + layout.nodeHeight / 2;
        const bend = Math.max(50, Math.abs(x2 - x1) * 0.45);
        const path = svgElement("path", {
          d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
          class: "graph-edge", "marker-end": "url(#graphArrow)"
        });
        const title = svgElement("title");
        title.textContent = `${nodeLabel(source)} — ${choice.label} → ${nodeLabel(target)}`;
        path.append(title);
        edges.append(path);
      }
    }
    els.graphSvg.append(edges);

    const nodeGroup = svgElement("g", { class: "graph-nodes" });
    for (const node of nodes) {
      const position = layout.positions.get(node.id);
      const classes = ["graph-node", `status-${node.status}`];
      if (node.id === state.selectedNodeId) classes.push("selected");
      if (node.id === state.currentNodeId) classes.push("current");
      const group = svgElement("g", {
        class: classes.join(" "), transform: `translate(${position.x} ${position.y})`,
        role: "button", tabindex: 0, "aria-label": `选择${nodeLabel(node)}，PDF 第 ${resolveNodePage(node)} 页`
      });
      group.append(svgElement("rect", { width: layout.nodeWidth, height: layout.nodeHeight, rx: 13 }));
      const idText = svgElement("text", { x: 14, y: 25, class: "graph-node-id" });
      idText.textContent = node.id;
      const titleText = svgElement("text", { x: 14, y: 47, class: "graph-node-title" });
      const rawTitle = node.title || `节点 ${node.id}`;
      titleText.textContent = rawTitle.length > 18 ? `${rawTitle.slice(0, 17)}…` : rawTitle;
      const pageText = svgElement("text", { x: layout.nodeWidth - 13, y: 25, class: "graph-node-page", "text-anchor": "end" });
      pageText.textContent = `PDF ${resolveNodePage(node)}`;
      group.append(idText, titleText, pageText);
      group.addEventListener("click", () => selectNode(node.id));
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectNode(node.id);
        }
      });
      nodeGroup.append(group);
    }
    els.graphSvg.append(nodeGroup);
    els.graphZoomOutButton.disabled = graphScale <= 0.5;
    els.graphZoomInButton.disabled = graphScale >= 2;
  }

  function openGraph() {
    graphScale = 1;
    renderGraph();
    els.graphDialog.showModal();
    requestAnimationFrame(fitGraph);
  }

  function fitGraph() {
    if (!sortedNodes().length) return;
    const viewBox = els.graphSvg.viewBox.baseVal;
    const availableWidth = Math.max(240, els.graphViewport.clientWidth - 36);
    const availableHeight = Math.max(180, els.graphViewport.clientHeight - 36);
    graphScale = Math.min(1.35, Math.max(0.5, Math.min(availableWidth / viewBox.width, availableHeight / viewBox.height)));
    renderGraph();
    els.graphViewport.scrollTo({ left: 0, top: 0 });
  }

  function changeGraphZoom(delta) {
    graphScale = Math.min(2, Math.max(0.5, Math.round((graphScale + delta) * 100) / 100));
    renderGraph();
  }

  function renderHistory() {
    els.historyCount.textContent = String(state.history.length);
    els.historyList.replaceChildren();
    const recent = state.history.slice(-20).reverse();
    if (!recent.length) {
      const empty = document.createElement("div");
      empty.className = "empty-list";
      empty.textContent = "跳转后会在这里留下记录";
      els.historyList.append(empty);
      return;
    }
    recent.forEach((entry, reversedIndex) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "history-item";
      const label = document.createElement("strong");
      label.textContent = entry.label;
      const page = document.createElement("span");
      page.textContent = `PDF ${entry.pdfPage}`;
      item.append(label, page);
      item.addEventListener("click", () => {
        const sourceIndex = state.history.length - 1 - reversedIndex;
        pushCurrentToHistory();
        const target = state.history[sourceIndex];
        state.history.splice(sourceIndex, 1);
        navigateToPage(target.pdfPage, { nodeId: target.nodeId, record: false });
      });
      els.historyList.append(item);
    });
  }

  function openNodeDialog(node = null) {
    els.nodeForm.reset();
    els.nodeFormError.textContent = "";
    els.editingNodeId.value = node?.id || "";
    els.nodeDialogTitle.textContent = node ? "编辑节点" : "添加节点";
    els.deleteNodeButton.hidden = !node;
    if (node) {
      els.nodeIdInput.value = node.id;
      els.nodeTitleInput.value = node.title;
      els.bookPageInput.value = node.bookPage || "";
      els.nodePdfPageInput.value = node.pdfPage || "";
      els.nodeStatusInput.value = node.status;
      els.nodeTagsInput.value = node.tags;
      els.nodeNoteInput.value = node.note;
    } else {
      const suggestedBookPage = state.currentPdfPage - state.offset;
      const suggestedValue = suggestedBookPage > 0 ? String(suggestedBookPage) : "";
      els.nodeIdInput.value = suggestedValue;
      els.bookPageInput.value = suggestedValue;
    }
    els.nodeDialog.showModal();
    setTimeout(() => els.nodeIdInput.focus(), 0);
  }

  function saveNodeFromForm(event) {
    event.preventDefault();
    const oldId = els.editingNodeId.value;
    const id = els.nodeIdInput.value.trim();
    if (!id) {
      els.nodeFormError.textContent = "请填写节点编号或名称。";
      els.nodeIdInput.focus();
      return;
    }
    if ((!oldId || oldId !== id) && state.nodes[id]) {
      els.nodeFormError.textContent = `节点“${id}”已经存在，请换一个编号。`;
      els.nodeIdInput.focus();
      return;
    }
    const bookPage = optionalPositiveInteger(els.bookPageInput.value) || (/^\d+$/.test(id) ? positiveInteger(id, null) : null);
    const pdfPage = optionalPositiveInteger(els.nodePdfPageInput.value);
    if (!bookPage && !pdfPage) {
      els.nodeFormError.textContent = "非数字节点需要填写书中页码或 PDF 页码。";
      els.bookPageInput.focus();
      return;
    }
    const previous = oldId ? state.nodes[oldId] : null;
    const node = {
      id,
      title: els.nodeTitleInput.value.trim(),
      bookPage,
      pdfPage,
      status: els.nodeStatusInput.value,
      tags: els.nodeTagsInput.value.trim(),
      note: els.nodeNoteInput.value.trim(),
      choices: previous?.choices || []
    };
    if (oldId && oldId !== id) {
      delete state.nodes[oldId];
      for (const other of Object.values(state.nodes)) {
        for (const choice of other.choices) if (choice.targetNodeId === oldId) choice.targetNodeId = id;
      }
      if (state.currentNodeId === oldId) state.currentNodeId = id;
      if (state.selectedNodeId === oldId) state.selectedNodeId = id;
      for (const entry of state.history) if (entry.nodeId === oldId) entry.nodeId = id;
    }
    state.nodes[id] = node;
    state.selectedNodeId = id;
    saveState();
    els.nodeDialog.close();
    render();
    showToast(previous ? "节点已更新" : "节点已添加");
  }

  function requestDeleteNode(id, closeDialog = false) {
    const node = state.nodes[id];
    if (!node) return;
    const incomingCount = Object.values(state.nodes).reduce((count, item) => {
      if (item.id === id) return count;
      return count + item.choices.filter((choice) => choice.targetNodeId === id).length;
    }, 0);
    const relationCount = incomingCount + node.choices.length;
    const relationWarning = relationCount ? `\n同时会删除与它相连的 ${relationCount} 条跳转关系。` : "";
    if (!window.confirm(`确定删除“${nodeLabel(node)}”吗？${relationWarning}`)) return;
    const snapshot = JSON.parse(JSON.stringify(state));
    delete state.nodes[id];
    for (const other of Object.values(state.nodes)) other.choices = other.choices.filter((choice) => choice.targetNodeId !== id);
    if (state.currentNodeId === id) state.currentNodeId = null;
    if (state.selectedNodeId === id) state.selectedNodeId = sortedNodes()[0]?.id || null;
    saveState();
    if (closeDialog) els.nodeDialog.close();
    closeNodeActionMenu();
    render();
    showToast(`已删除节点 ${id}`, "撤销", () => {
      state = snapshot;
      saveState();
      updatePdfFrame();
      render();
    });
  }

  function deleteCurrentEditingNode() {
    requestDeleteNode(els.editingNodeId.value, true);
  }

  function openChoiceForm(choice = null) {
    const node = selectedNode();
    const options = sortedNodes().filter((item) => item.id !== node?.id);
    if (!options.length) {
      showToast("请先添加至少一个目标节点");
      return;
    }
    els.choiceTarget.replaceChildren(...options.map((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${nodeLabel(item)} · PDF ${resolveNodePage(item)}`;
      return option;
    }));
    editingChoiceId = choice?.id || null;
    els.choiceLabel.value = choice?.label || "";
    if (choice && state.nodes[choice.targetNodeId]) els.choiceTarget.value = choice.targetNodeId;
    els.saveChoiceButton.textContent = choice ? "更新关系" : "保存关系";
    els.choiceForm.hidden = false;
    els.choiceLabel.focus();
  }

  function saveChoice(event) {
    event.preventDefault();
    const node = selectedNode();
    if (!node) return;
    const label = els.choiceLabel.value.trim();
    const targetNodeId = els.choiceTarget.value;
    if (!label || !state.nodes[targetNodeId]) return;
    const existing = editingChoiceId ? node.choices.find((choice) => choice.id === editingChoiceId) : null;
    if (existing) {
      existing.label = label;
      existing.targetNodeId = targetNodeId;
    } else {
      node.choices.push({ id: uid(), label, targetNodeId });
    }
    saveState();
    editingChoiceId = null;
    els.choiceForm.reset();
    els.choiceForm.hidden = true;
    renderCurrentNode();
    showToast(existing ? "跳转关系已更新" : "跳转关系已添加");
  }

  function handleJump(event) {
    event.preventDefault();
    const value = els.jumpInput.value.trim();
    if (state.nodes[value]) {
      navigateToNode(value);
    } else if (/^\d+$/.test(value)) {
      const bookPage = Number(value);
      navigateToPage(Math.max(1, bookPage + state.offset));
    } else {
      showToast("找不到该节点；直接跳页时请输入数字");
    }
    els.jumpInput.select();
  }

  function goBack() {
    const target = state.history.pop();
    if (!target) return;
    navigateToPage(target.pdfPage, { nodeId: target.nodeId, record: false });
  }

  function exportData() {
    const payload = { ...state, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const base = (state.pdfName || "游戏书").replace(/\.pdf$/i, "").replace(/[\\/:*?\"<>|]/g, "-");
    link.href = url;
    link.download = `${base}-书签数据.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    closeMoreMenu();
    showToast("书签数据已导出");
  }

  async function importData(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = normalizeState(parsed);
      const activePdfName = pdfDocument ? state.pdfName : imported.pdfName;
      state = imported;
      state.pdfName = activePdfName;
      if (pdfDocument) state.currentPdfPage = Math.min(state.currentPdfPage, pdfDocument.numPages);
      saveState();
      updatePdfFrame();
      render();
      showToast("书签数据已导入");
    } catch {
      showToast("导入失败：文件不是有效的书签数据");
    } finally {
      els.importInput.value = "";
      closeMoreMenu();
    }
  }

  function resetData() {
    const confirmed = window.confirm("确定清空当前书籍的节点、关系、备注和历史吗？建议先导出备份。");
    if (!confirmed) return;
    const activePdfName = state.pdfName;
    if (activePdfName) delete library[activePdfName];
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(library)); } catch { /* saveState 会提示错误 */ }
    state = defaultState();
    state.pdfName = activePdfName;
    saveState();
    closeMoreMenu();
    render();
    updatePdfFrame();
    showToast("当前书籍的数据已清空");
  }

  function showToast(message, actionLabel = "", action = null) {
    clearTimeout(toastTimer);
    undoAction = action;
    els.toastMessage.textContent = message;
    els.toastAction.textContent = actionLabel;
    els.toastAction.hidden = !action;
    els.toast.hidden = false;
    toastTimer = setTimeout(() => { els.toast.hidden = true; undoAction = null; }, action ? 7000 : 3500);
  }

  function closeMoreMenu() {
    els.moreMenu.hidden = true;
    els.moreButton.setAttribute("aria-expanded", "false");
  }

  function closeNodeActionMenu() {
    els.nodeActionMenu.hidden = true;
    els.nodeMoreButton.setAttribute("aria-expanded", "false");
  }

  els.pdfInput.addEventListener("change", () => handlePdfFile(els.pdfInput.files[0]));
  els.importInput.addEventListener("change", () => importData(els.importInput.files[0]));
  els.jumpForm.addEventListener("submit", handleJump);
  els.previousPageButton.addEventListener("click", () => navigateToPage(Math.max(1, state.currentPdfPage - 1)));
  els.nextPageButton.addEventListener("click", () => navigateToPage(state.currentPdfPage + 1));
  els.backButton.addEventListener("click", goBack);
  els.zoomOutButton.addEventListener("click", () => changeZoom(-0.25));
  els.zoomInButton.addEventListener("click", () => changeZoom(0.25));
  els.sidebarToggleButton.addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    saveState();
    renderLayout();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderPdfPage(), 190);
  });
  els.offsetInput.addEventListener("change", () => {
    state.offset = asInteger(els.offsetInput.value, 0);
    saveState();
    render();
    showToast("页码偏移已保存");
  });
  els.fullscreenButton.addEventListener("click", () => {
    if (!document.fullscreenElement) els.pdfStage.requestFullscreen?.();
    else document.exitFullscreen?.();
  });
  document.addEventListener("fullscreenchange", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderPdfPage(), 120);
  });
  els.moreButton.addEventListener("click", () => {
    const willOpen = els.moreMenu.hidden;
    els.moreMenu.hidden = !willOpen;
    els.moreButton.setAttribute("aria-expanded", String(willOpen));
  });
  document.addEventListener("click", (event) => {
    if (!els.moreMenu.hidden && !els.moreMenu.contains(event.target) && !els.moreButton.contains(event.target)) closeMoreMenu();
    if (!els.nodeActionMenu.hidden && !els.nodeActionMenu.contains(event.target) && !els.nodeMoreButton.contains(event.target)) closeNodeActionMenu();
  });
  els.exportButton.addEventListener("click", exportData);
  els.resetButton.addEventListener("click", resetData);
  els.addNodeButton.addEventListener("click", () => openNodeDialog());
  els.editCurrentNodeButton.addEventListener("click", () => openNodeDialog(selectedNode()));
  els.jumpSelectedNodeButton.addEventListener("click", () => {
    const node = selectedNode();
    if (node) navigateToNode(node.id);
  });
  els.nodeMoreButton.addEventListener("click", () => {
    const willOpen = els.nodeActionMenu.hidden;
    els.nodeActionMenu.hidden = !willOpen;
    els.nodeMoreButton.setAttribute("aria-expanded", String(willOpen));
  });
  els.deleteSelectedNodeButton.addEventListener("click", () => {
    const node = selectedNode();
    if (node) requestDeleteNode(node.id);
  });
  els.openGraphButton.addEventListener("click", openGraph);
  els.closeGraphButton.addEventListener("click", () => els.graphDialog.close());
  els.graphZoomOutButton.addEventListener("click", () => changeGraphZoom(-0.2));
  els.graphZoomInButton.addEventListener("click", () => changeGraphZoom(0.2));
  els.graphFitButton.addEventListener("click", fitGraph);
  els.graphJumpButton.addEventListener("click", () => {
    const node = selectedNode();
    if (!node) return;
    navigateToNode(node.id);
    els.graphDialog.close();
  });
  els.nodeSearch.addEventListener("input", renderNodeList);
  els.nodeForm.addEventListener("submit", saveNodeFromForm);
  els.deleteNodeButton.addEventListener("click", deleteCurrentEditingNode);
  els.closeNodeDialogButton.addEventListener("click", () => els.nodeDialog.close());
  els.cancelNodeButton.addEventListener("click", () => els.nodeDialog.close());
  els.addChoiceButton.addEventListener("click", openChoiceForm);
  els.cancelChoiceButton.addEventListener("click", () => { editingChoiceId = null; els.choiceForm.hidden = true; els.choiceForm.reset(); });
  els.choiceForm.addEventListener("submit", saveChoice);
  els.toastAction.addEventListener("click", () => {
    if (undoAction) undoAction();
    els.toast.hidden = true;
    undoAction = null;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.nodeActionMenu.hidden) closeNodeActionMenu();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      els.jumpInput.focus();
    }
    if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); goBack(); }
    if (
      event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      els.nodeDialog.open || els.graphDialog.open ||
      event.target.closest?.("input, textarea, select, [contenteditable='true']") ||
      !pdfDocument
    ) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      if (state.currentPdfPage > 1) navigateToPage(state.currentPdfPage - 1);
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      if (state.currentPdfPage < pdfDocument.numPages) navigateToPage(state.currentPdfPage + 1);
    }
  });

  window.addEventListener("resize", () => {
    if (!pdfDocument) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderPdfPage(), 120);
  });

  render();
})();
