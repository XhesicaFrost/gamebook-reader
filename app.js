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
    version: 3,
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
  let readablePdfPages = [];
  let readablePdfPageIndexes = new Map();
  let zoomFactor = 1;
  let resizeTimer = null;
  let toastTimer = null;
  let undoAction = null;
  let editingChoiceId = null;
  let choiceTargetCandidates = [];
  let graphScale = 1;
  let graphFocusedNodeId = null;
  let graphNodePositions = new Map();
  const GRAPH_MIN_SCALE = 0.1;
  const GRAPH_MAX_SCALE = 2.5;

  const $ = (id) => document.getElementById(id);
  const els = {
    workspace: document.querySelector(".workspace"), pdfInput: $("pdfInput"), importInput: $("importInput"),
    pdfViewport: $("pdfViewport"), pdfCanvas: $("pdfCanvas"), pdfEmpty: $("pdfEmpty"), pdfLoading: $("pdfLoading"), pdfLoadingText: $("pdfLoadingText"),
    pdfStage: $("pdfStage"), bookName: $("bookName"), autosaveStatus: $("autosaveStatus"), currentPdfPage: $("currentPdfPage"), totalPdfPages: $("totalPdfPages"),
    offsetInput: $("offsetInput"), jumpForm: $("jumpForm"), jumpInput: $("jumpInput"),
    previousPageButton: $("previousPageButton"), nextPageButton: $("nextPageButton"), backButton: $("backButton"),
    zoomOutButton: $("zoomOutButton"), zoomInButton: $("zoomInButton"), zoomLabel: $("zoomLabel"),
    sidebarToggleButton: $("sidebarToggleButton"), fullscreenButton: $("fullscreenButton"), moreButton: $("moreButton"), moreMenu: $("moreMenu"),
    shortcutHelpButton: $("shortcutHelpButton"), exportButton: $("exportButton"), resetButton: $("resetButton"),
    noCurrentNode: $("noCurrentNode"), currentNodeContent: $("currentNodeContent"),
    currentNodeTitle: $("currentNodeTitle"), currentNodeStatus: $("currentNodeStatus"), currentNodeVisited: $("currentNodeVisited"),
    currentNodeEnding: $("currentNodeEnding"), currentNodeMeta: $("currentNodeMeta"),
    currentNodeTags: $("currentNodeTags"), currentNodeNote: $("currentNodeNote"), editCurrentNodeButton: $("editCurrentNodeButton"), jumpSelectedNodeButton: $("jumpSelectedNodeButton"),
    nodeMoreButton: $("nodeMoreButton"), nodeActionMenu: $("nodeActionMenu"), toggleVisitedNodeButton: $("toggleVisitedNodeButton"),
    toggleEndingNodeButton: $("toggleEndingNodeButton"), deleteSelectedNodeButton: $("deleteSelectedNodeButton"),
    choiceList: $("choiceList"), choiceForm: $("choiceForm"), addChoiceButton: $("addChoiceButton"),
    choiceLabel: $("choiceLabel"), choiceTargetSearch: $("choiceTargetSearch"), choiceTargetHint: $("choiceTargetHint"),
    choiceTarget: $("choiceTarget"), cancelChoiceButton: $("cancelChoiceButton"), saveChoiceButton: $("saveChoiceButton"),
    addNodeButton: $("addNodeButton"), openGraphButton: $("openGraphButton"), nodeCount: $("nodeCount"), nodeSearch: $("nodeSearch"), nodeList: $("nodeList"),
    historyCount: $("historyCount"), historyList: $("historyList"),
    nodeDialog: $("nodeDialog"), nodeForm: $("nodeForm"), nodeDialogTitle: $("nodeDialogTitle"), editingNodeId: $("editingNodeId"),
    nodeIdInput: $("nodeIdInput"), nodeTitleInput: $("nodeTitleInput"), bookPageInput: $("bookPageInput"),
    nodePdfPageInput: $("nodePdfPageInput"), nodeStatusInput: $("nodeStatusInput"), nodeTagsInput: $("nodeTagsInput"),
    nodeEndingInput: $("nodeEndingInput"), nodeVisitedInput: $("nodeVisitedInput"),
    nodeNoteInput: $("nodeNoteInput"), nodeFormError: $("nodeFormError"), deleteNodeButton: $("deleteNodeButton"),
    closeNodeDialogButton: $("closeNodeDialogButton"), cancelNodeButton: $("cancelNodeButton"),
    graphDialog: $("graphDialog"), graphViewport: $("graphViewport"), graphCanvas: $("graphCanvas"), graphSvg: $("graphSvg"), graphEmpty: $("graphEmpty"),
    graphSelectionLabel: $("graphSelectionLabel"), graphJumpButton: $("graphJumpButton"), graphZoomOutButton: $("graphZoomOutButton"),
    graphZoomInButton: $("graphZoomInButton"), graphZoomLabel: $("graphZoomLabel"), graphFitButton: $("graphFitButton"), closeGraphButton: $("closeGraphButton"),
    graphNodeSearch: $("graphNodeSearch"), graphSearchHint: $("graphSearchHint"),
    shortcutDialog: $("shortcutDialog"), closeShortcutDialogButton: $("closeShortcutDialogButton"),
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
    const nodesWithoutVisited = new Set();
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
        if (!("visited" in rawNode) && !("isVisited" in rawNode)) nodesWithoutVisited.add(id);
        base.nodes[id] = {
          id,
          title: stringValue(rawNode.title),
          bookPage: optionalPositiveInteger(rawNode.bookPage),
          pdfPage: optionalPositiveInteger(rawNode.pdfPage),
          status: STATUS_LABELS[rawNode.status] ? rawNode.status : "none",
          ending: Boolean(rawNode.ending ?? rawNode.isEnding),
          visited: Boolean(rawNode.visited ?? rawNode.isVisited),
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
    if (base.currentNodeId && nodesWithoutVisited.has(base.currentNodeId)) base.nodes[base.currentNodeId].visited = true;
    for (const entry of base.history) {
      if (entry.nodeId && base.nodes[entry.nodeId] && nodesWithoutVisited.has(entry.nodeId)) base.nodes[entry.nodeId].visited = true;
    }
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
  function resolveNodeBookPage(node) {
    if (node.bookPage) return node.bookPage;
    const numericId = Number(node.id);
    return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
  }
  function readingPageCount() {
    return readablePdfPages.length || pdfDocument?.numPages || 0;
  }
  function physicalPageForReadingPage(page) {
    const readingPage = positiveInteger(page, 0);
    if (!readingPage) return 0;
    if (!readablePdfPages.length) return readingPage;
    return readablePdfPages[readingPage - 1] || 0;
  }
  function readingPageForPhysicalPage(page) {
    const physicalPage = positiveInteger(page, 0);
    if (!physicalPage) return 0;
    if (!readablePdfPages.length) return physicalPage;
    if (readablePdfPageIndexes.has(physicalPage)) return readablePdfPageIndexes.get(physicalPage);
    const nextIndex = readablePdfPages.findIndex((candidate) => candidate > physicalPage);
    return nextIndex === -1 ? readablePdfPages.length : nextIndex + 1;
  }
  function normalizePhysicalPage(page) {
    const physicalPage = positiveInteger(page, 0);
    if (!physicalPage || !readablePdfPages.length) return physicalPage;
    if (readablePdfPageIndexes.has(physicalPage)) return physicalPage;
    return readablePdfPages.find((candidate) => candidate > physicalPage) || readablePdfPages.at(-1) || 0;
  }
  function physicalPageForBookPage(page) {
    const bookPage = positiveInteger(page, 0);
    if (!bookPage) return 0;
    return physicalPageForReadingPage(Math.max(1, bookPage + state.offset));
  }
  function resolveNodePage(node) {
    if (node.pdfPage) return normalizePhysicalPage(node.pdfPage);
    return physicalPageForBookPage(resolveNodeBookPage(node)) || 1;
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function createPdfImageInspector(data) {
    const source = new TextDecoder("windows-1252").decode(data);
    const offsets = new Map();
    const objectPattern = /(?:^|[\r\n])(\d+)\s+(\d+)\s+obj\s*<</g;
    for (const match of source.matchAll(objectPattern)) offsets.set(Number(match[1]), match.index + match[0].indexOf(match[1]));

    const balancedDictionary = (start) => {
      if (start < 0) return "";
      let depth = 0;
      for (let index = start; index < source.length - 1; index += 1) {
        const pair = source.slice(index, index + 2);
        if (pair === "<<") { depth += 1; index += 1; continue; }
        if (pair === ">>") {
          depth -= 1;
          index += 1;
          if (depth === 0) return source.slice(start, index + 1);
        }
      }
      return "";
    };
    const objectDictionary = (objectNumber) => {
      const offset = offsets.get(Number(objectNumber));
      if (offset == null) return "";
      return balancedDictionary(source.indexOf("<<", offset));
    };
    const namedDictionary = (dictionary, name) => {
      const reference = dictionary.match(new RegExp(`/${name}\\s+(\\d+)\\s+\\d+\\s+R`));
      if (reference) return objectDictionary(reference[1]);
      const tokenIndex = dictionary.indexOf(`/${name}`);
      if (tokenIndex < 0) return "";
      const nestedStart = dictionary.indexOf("<<", tokenIndex);
      if (nestedStart < 0) return "";
      let depth = 0;
      for (let index = nestedStart; index < dictionary.length - 1; index += 1) {
        const pair = dictionary.slice(index, index + 2);
        if (pair === "<<") { depth += 1; index += 1; continue; }
        if (pair === ">>") {
          depth -= 1;
          index += 1;
          if (depth === 0) return dictionary.slice(nestedStart, index + 1);
        }
      }
      return "";
    };

    return (pageReference) => {
      const pageDictionary = objectDictionary(pageReference);
      const resources = namedDictionary(pageDictionary, "Resources");
      const xObjects = namedDictionary(resources, "XObject");
      if (!xObjects) return [];
      const images = [];
      for (const match of xObjects.matchAll(/\/[A-Za-z0-9_.-]+\s+(\d+)\s+\d+\s+R/g)) {
        const imageDictionary = objectDictionary(match[1]);
        if (!/\/Subtype\s*\/Image\b/.test(imageDictionary)) continue;
        const width = Number(imageDictionary.match(/\/Width\s+(\d+)/)?.[1]);
        const height = Number(imageDictionary.match(/\/Height\s+(\d+)/)?.[1]);
        if (width > 0 && height > 0) images.push({ width, height });
      }
      return images;
    };
  }

  async function buildReadablePageMap(document, inspectPageImages) {
    const dimensions = [];
    const batchSize = 24;
    for (let start = 1; start <= document.numPages; start += batchSize) {
      const numbers = Array.from({ length: Math.min(batchSize, document.numPages - start + 1) }, (_, index) => start + index);
      const pages = await Promise.all(numbers.map((pageNumber) => document.getPage(pageNumber)));
      pages.forEach((page, index) => {
        const viewport = page.getViewport({ scale: 1 });
        dimensions.push({ page: numbers[index], width: viewport.width, height: viewport.height, reference: page.ref?.num });
        page.cleanup();
      });
    }
    const medianWidth = median(dimensions.map((item) => item.width));
    const medianHeight = median(dimensions.map((item) => item.height));
    const dimensionByPage = new Map(dimensions.map((item) => [item.page, item]));
    const fragmentSeeds = dimensions
      .filter((item) => item.width >= medianWidth * 0.8 && item.width <= medianWidth * 1.2 && item.height < medianHeight * 0.78)
      .map((item) => item.page);
    const removedPages = new Set();
    for (const seed of fragmentSeeds) {
      if (removedPages.has(seed)) continue;
      const start = Math.max(1, seed - 1);
      const referenceImages = inspectPageImages(dimensionByPage.get(start)?.reference);
      const referenceArea = Math.max(0, ...referenceImages.map((image) => image.width * image.height));
      let completePage = 0;
      const searchEnd = Math.min(document.numPages, seed + 24);
      for (let candidate = seed + 1; candidate <= searchEnd; candidate += 1) {
        const box = dimensionByPage.get(candidate);
        const hasTypicalPageBox = box &&
          box.width >= medianWidth * 0.8 && box.width <= medianWidth * 1.2 &&
          box.height >= medianHeight * 0.78 && box.height <= medianHeight * 1.22;
        if (!hasTypicalPageBox) continue;
        const pageRatio = box.width / box.height;
        const images = inspectPageImages(box.reference);
        const hasFullPageImage = images.some((image) => {
          const aspectMatches = Math.abs((image.width / image.height) / pageRatio - 1) < 0.15;
          const resolutionMatches = !referenceArea || image.width * image.height >= referenceArea * 0.45;
          return aspectMatches && resolutionMatches;
        });
        if (hasFullPageImage) {
          completePage = candidate;
          break;
        }
      }
      if (completePage) {
        for (let page = start; page < completePage; page += 1) removedPages.add(page);
      } else {
        removedPages.add(seed);
      }
    }
    readablePdfPages = dimensions.filter((item) => !removedPages.has(item.page)).map((item) => item.page);
    if (!readablePdfPages.length) readablePdfPages = dimensions.map((item) => item.page);
    readablePdfPageIndexes = new Map(readablePdfPages.map((page, index) => [page, index + 1]));
  }

  function pushCurrentToHistory() {
    const node = currentNode();
    const latest = state.history[state.history.length - 1];
    const readingPage = readingPageForPhysicalPage(state.currentPdfPage);
    const entry = { nodeId: state.currentNodeId, pdfPage: state.currentPdfPage, label: node ? nodeLabel(node) : `阅读页 ${readingPage}` };
    if (!latest || latest.nodeId !== entry.nodeId || latest.pdfPage !== entry.pdfPage) {
      state.history.push(entry);
      state.history = state.history.slice(-100);
    }
  }

  function navigateToPage(page, options = {}) {
    const requestedPage = positiveInteger(page, 0);
    if (!requestedPage) {
      showToast("页码必须是大于 0 的整数");
      return false;
    }
    if (pdfDocument && requestedPage > pdfDocument.numPages) {
      showToast(`这本书只有 ${readingPageCount()} 个可读页面`);
      return false;
    }
    const targetPage = normalizePhysicalPage(requestedPage);
    if (options.record !== false && targetPage !== state.currentPdfPage) pushCurrentToHistory();
    state.currentPdfPage = targetPage;
    const targetNodeId = options.nodeId == null ? null : String(options.nodeId);
    const targetNode = targetNodeId ? state.nodes[targetNodeId] : null;
    state.currentNodeId = targetNode ? targetNodeId : null;
    if (targetNode) {
      targetNode.visited = true;
      state.selectedNodeId = targetNodeId;
    }
    saveState();
    updatePdfFrame();
    render();
    return true;
  }

  function navigateToReadingPage(page, options = {}) {
    const physicalPage = physicalPageForReadingPage(page);
    if (!physicalPage) {
      showToast(`这本书只有 ${readingPageCount()} 个可读页面`);
      return;
    }
    navigateToPage(physicalPage, options);
  }

  function navigateByPage(delta) {
    const current = readingPageForPhysicalPage(state.currentPdfPage);
    navigateToReadingPage(current + delta);
  }

  function navigateToNode(id, options = {}) {
    const node = state.nodes[String(id)];
    if (!node) {
      showToast(`找不到节点 ${id}`);
      return false;
    }
    return navigateToPage(resolveNodePage(node), { nodeId: node.id, record: options.record });
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
    els.currentPdfPage.textContent = String(readingPageForPhysicalPage(state.currentPdfPage) || 1);
    if (pdfDocument) renderPdfPage();
  }

  function showPdfLoading(message) {
    els.pdfLoadingText.textContent = message;
    els.pdfLoading.hidden = false;
  }

  function hidePdfLoading() {
    els.pdfLoading.hidden = true;
  }

  class EmbeddedPdfBinaryDataFactory {
    async fetch({ filename }) {
      const encoded = window.PDFJS_WASM_DATA?.[filename];
      if (!encoded) throw new Error(`没有内置 PDF 解码资源：${filename}`);
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }
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
    showPdfLoading(`正在显示阅读页 ${readingPageForPhysicalPage(pageNumber)}…`);
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
      canvas.setAttribute("aria-label", `书籍阅读页 ${readingPageForPhysicalPage(pageNumber)}，共 ${readingPageCount()} 页`);
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
      const inspectPageImages = createPdfImageInspector(data);
      const isLocalFile = location.protocol === "file:";
      pdfLoadingTask = window.pdfjsLib.getDocument({
        data,
        isEvalSupported: false,
        wasmUrl: new URL("vendor/pdfjs-wasm/", document.baseURI).href,
        useWorkerFetch: false,
        BinaryDataFactory: isLocalFile ? EmbeddedPdfBinaryDataFactory : undefined
      });
      pdfDocument = await pdfLoadingTask.promise;
      pdfLoadingTask = null;
      showPdfLoading("正在整理页面…");
      await buildReadablePageMap(pdfDocument, inspectPageImages);
      const hadSavedBookmarks = Boolean(library[file.name]);
      state = hadSavedBookmarks ? normalizeState(library[file.name]) : defaultState();
      state.pdfName = file.name;
      state.currentPdfPage = normalizePhysicalPage(Math.min(state.currentPdfPage, pdfDocument.numPages));
      saveState();
      els.pdfEmpty.hidden = true;
      els.pdfViewport.hidden = false;
      els.totalPdfPages.textContent = String(readingPageCount());
      zoomFactor = 1;
      updateZoomControls();
      render();
      await renderPdfPage();
      const bookmarkMessage = hadSavedBookmarks
        ? `已自动加载 ${Object.keys(state.nodes).length} 个同名书签`
        : "已为这份 PDF 创建同名书签数据";
      showToast(`${bookmarkMessage} · 共 ${readingPageCount()} 个可读页面`);
    } catch (error) {
      console.error(error);
      pdfDocument = null;
      pdfLoadingTask = null;
      readablePdfPages = [];
      readablePdfPageIndexes = new Map();
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
    const currentReadingPage = readingPageForPhysicalPage(state.currentPdfPage) || 1;
    els.currentPdfPage.textContent = String(currentReadingPage);
    els.backButton.disabled = state.history.length === 0;
    els.previousPageButton.disabled = !pdfDocument || currentReadingPage <= 1;
    els.nextPageButton.disabled = !pdfDocument || currentReadingPage >= readingPageCount();
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
    els.currentNodeVisited.hidden = !node.visited;
    els.currentNodeEnding.hidden = !node.ending;
    els.toggleVisitedNodeButton.lastElementChild.textContent = node.visited ? "标记为未走过" : "标记为已走过";
    els.toggleEndingNodeButton.lastElementChild.textContent = node.ending ? "取消结局标记" : "标记为结局";
    const resolvedBookPage = resolveNodeBookPage(node);
    const bookText = resolvedBookPage ? `书中第 ${resolvedBookPage} 页` : "未设置书中页码";
    const pageSource = node.pdfPage ? "固定" : "偏移计算";
    const readingText = node.id === state.currentNodeId ? " · 正在阅读" : "";
    els.currentNodeMeta.textContent = `${bookText} · 编号 ${node.id} · 阅读页 ${readingPageForPhysicalPage(resolveNodePage(node))}（${pageSource}）${readingText}`;
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
    for (const [choiceIndex, choice] of node.choices.entries()) {
      const target = state.nodes[choice.targetNodeId];
      const row = document.createElement("div");
      row.className = "choice-row";
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "choice-jump";
      jump.disabled = !target;
      const mainline = document.createElement("span");
      mainline.className = "choice-mainline";
      const shortcutNumber = choiceIndex < 10 ? (choiceIndex + 1) % 10 : null;
      if (shortcutNumber !== null) {
        const shortcut = document.createElement("kbd");
        shortcut.textContent = String(shortcutNumber);
        shortcut.setAttribute("aria-hidden", "true");
        mainline.append(shortcut);
        jump.setAttribute("aria-keyshortcuts", String(shortcutNumber));
      }
      const label = document.createElement("strong");
      label.textContent = choice.label;
      mainline.append(label);
      const meta = document.createElement("span");
      const targetBookPage = target ? resolveNodeBookPage(target) : null;
      meta.textContent = target ? `前往 ${nodeLabel(target)}${targetBookPage ? ` · 书中第 ${targetBookPage} 页` : ""}` : `目标节点 ${choice.targetNodeId} 已不存在`;
      jump.append(mainline, meta);
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

  function nodeMatchesQuery(node, query) {
    return [
      node.id, node.title, node.tags, node.note, STATUS_LABELS[node.status],
      resolveNodeBookPage(node) ? `书中第 ${resolveNodeBookPage(node)} 页 书 ${resolveNodeBookPage(node)}` : "",
      node.ending ? "结局 结局节点" : "", node.visited ? "已走过 已访问" : ""
    ].join(" ").toLocaleLowerCase().includes(query);
  }

  function renderNodeList() {
    const nodes = sortedNodes();
    const query = els.nodeSearch.value.trim().toLocaleLowerCase();
    const visible = query ? nodes.filter((node) => nodeMatchesQuery(node, query)) : nodes;
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
      if (node.visited) row.classList.add("is-visited");
      if (node.ending) row.classList.add("is-ending");
      const item = document.createElement("button");
      item.type = "button";
      item.className = "node-item";
      item.dataset.nodeId = node.id;
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
      const markers = [];
      if (node.id === state.currentNodeId) markers.push("正在阅读");
      if (node.visited) markers.push("已走过");
      if (node.ending) markers.push("结局");
      if (node.status !== "none") markers.push(STATUS_LABELS[node.status]);
      detail.textContent = `${markers.length ? `${markers.join(" · ")} · ` : ""}${node.tags || "无文本标签"}`;
      copy.append(title, detail);
      const page = document.createElement("span");
      page.className = "node-page";
      const bookPage = resolveNodeBookPage(node);
      page.textContent = bookPage ? `书 ${bookPage}` : "书页 —";
      page.title = `阅读页 ${readingPageForPhysicalPage(resolveNodePage(node))}`;
      item.append(number, copy, page);
      item.addEventListener("click", () => selectNode(node.id));
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "node-jump-button";
      jump.textContent = "跳转";
      jump.setAttribute("aria-label", `跳转到${nodeLabel(node)}${bookPage ? `，书中第 ${bookPage} 页` : ""}`);
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

  function graphEdgeIdentity(sourceId, choiceIndex) {
    return `${sourceId}\u0000${choiceIndex}`;
  }

  function reorderGraphColumn(columns, levels, neighbors, level, neighborLevel) {
    const column = columns.get(level);
    const neighborColumn = columns.get(neighborLevel);
    if (!column?.length || !neighborColumn?.length) return;
    const neighborOrder = new Map(neighborColumn.map((node, index) => [node.id, index]));
    const previousOrder = new Map(column.map((node, index) => [node.id, index]));
    const fallbackScale = neighborColumn.length / Math.max(1, column.length);
    const scores = new Map(column.map((node) => {
      const linkedIndexes = Array.from(neighbors.get(node.id) || [])
        .filter((id) => levels.get(id) === neighborLevel)
        .map((id) => neighborOrder.get(id));
      const score = linkedIndexes.length
        ? linkedIndexes.reduce((sum, index) => sum + index, 0) / linkedIndexes.length
        : (previousOrder.get(node.id) + 0.5) * fallbackScale;
      return [node.id, score];
    }));
    columns.set(level, [...column].sort((a, b) => scores.get(a.id) - scores.get(b.id) || previousOrder.get(a.id) - previousOrder.get(b.id)));
  }

  function graphLayout(nodes) {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const incoming = Object.fromEntries(nodes.map((node) => [node.id, 0]));
    const neighbors = new Map(nodes.map((node) => [node.id, new Set()]));
    for (const node of nodes) {
      for (const choice of node.choices) {
        if (!nodeIds.has(choice.targetNodeId)) continue;
        incoming[choice.targetNodeId] += 1;
        neighbors.get(node.id).add(choice.targetNodeId);
        neighbors.get(choice.targetNodeId).add(node.id);
      }
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
    const maxLevel = Math.max(0, ...columns.keys());
    for (let pass = 0; pass < 6; pass += 1) {
      for (let level = 1; level <= maxLevel; level += 1) reorderGraphColumn(columns, levels, neighbors, level, level - 1);
      for (let level = maxLevel - 1; level >= 0; level -= 1) reorderGraphColumn(columns, levels, neighbors, level, level + 1);
    }
    const backwardEdges = [];
    for (const source of nodes) {
      source.choices.forEach((choice, choiceIndex) => {
        if (!nodeIds.has(choice.targetNodeId) || levels.get(choice.targetNodeId) > levels.get(source.id)) return;
        backwardEdges.push({
          key: graphEdgeIdentity(source.id, choiceIndex),
          start: levels.get(choice.targetNodeId),
          end: levels.get(source.id)
        });
      });
    }
    backwardEdges.sort((a, b) => a.start - b.start || a.end - b.end);
    const backwardLanes = new Map();
    const laneEnds = [];
    for (const edge of backwardEdges) {
      let lane = laneEnds.findIndex((end) => edge.start > end);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = edge.end;
      backwardLanes.set(edge.key, lane);
    }
    const positions = new Map();
    const nodeWidth = 176;
    const nodeHeight = 78;
    const maximumDegree = Math.max(1, ...nodes.map((node) => Math.max(node.choices.filter((choice) => nodeIds.has(choice.targetNodeId)).length, incoming[node.id])));
    const horizontalGap = 168 + Math.min(96, Math.max(0, maximumDegree - 2) * 16);
    const verticalGap = 48 + Math.min(32, Math.max(0, maximumDegree - 3) * 8);
    const margin = 60;
    const backwardLaneGap = 30;
    const topReserve = laneEnds.length * backwardLaneGap;
    let maxRows = 1;
    for (const column of columns.values()) maxRows = Math.max(maxRows, column.length);
    const contentHeight = maxRows * nodeHeight + (maxRows - 1) * verticalGap;
    const orders = new Map();
    for (const [level, column] of columns) {
      const columnHeight = column.length * nodeHeight + Math.max(0, column.length - 1) * verticalGap;
      const columnTop = margin + topReserve + (contentHeight - columnHeight) / 2;
      column.forEach((node, index) => {
        orders.set(node.id, index);
        positions.set(node.id, {
          x: margin + level * (nodeWidth + horizontalGap),
          y: columnTop + index * (nodeHeight + verticalGap)
        });
      });
    }
    return {
      positions, levels, orders, backwardLanes, backwardLaneGap, nodeWidth, nodeHeight,
      width: margin * 2 + (maxLevel + 1) * nodeWidth + maxLevel * horizontalGap,
      height: margin * 2 + topReserve + contentHeight
    };
  }

  function graphPortOffset(index, count) {
    if (count <= 1) return 0;
    const span = Math.min(50, (count - 1) * 14);
    return -span / 2 + span * index / (count - 1);
  }

  function graphCubicPoint(edge, t) {
    const inverse = 1 - t;
    return {
      x: inverse ** 3 * edge.x1 + 3 * inverse ** 2 * t * edge.c1x + 3 * inverse * t ** 2 * edge.c2x + t ** 3 * edge.x2,
      y: inverse ** 3 * edge.y1 + 3 * inverse ** 2 * t * edge.c1y + 3 * inverse * t ** 2 * edge.c2y + t ** 3 * edge.y2
    };
  }

  function graphCubicTangent(edge, t) {
    const inverse = 1 - t;
    return {
      x: 3 * inverse ** 2 * (edge.c1x - edge.x1) + 6 * inverse * t * (edge.c2x - edge.c1x) + 3 * t ** 2 * (edge.x2 - edge.c2x),
      y: 3 * inverse ** 2 * (edge.c1y - edge.y1) + 6 * inverse * t * (edge.c2y - edge.c1y) + 3 * t ** 2 * (edge.y2 - edge.c2y)
    };
  }

  function graphRectOverlapArea(a, b, padding = 0) {
    const width = Math.max(0, Math.min(a.right, b.right + padding) - Math.max(a.left, b.left - padding));
    const height = Math.max(0, Math.min(a.bottom, b.bottom + padding) - Math.max(a.top, b.top - padding));
    return width * height;
  }

  function placeGraphEdgeLabel(edge, width, layout, nodeObstacles, labelObstacles) {
    const height = 22;
    const candidates = [];
    for (const offset of [0, 18, -18, 34, -34]) {
      for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78]) {
        const point = graphCubicPoint(edge, t);
        const tangent = graphCubicTangent(edge, t);
        const length = Math.hypot(tangent.x, tangent.y) || 1;
        const x = point.x - tangent.y / length * offset;
        const y = point.y + tangent.x / length * offset;
        const rect = { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 };
        if (rect.left < 8 || rect.right > layout.width - 8 || rect.top < 8 || rect.bottom > layout.height - 8) continue;
        const nodeOverlap = nodeObstacles.reduce((sum, obstacle) => sum + graphRectOverlapArea(rect, obstacle, 7), 0);
        const labelOverlap = labelObstacles.reduce((sum, obstacle) => sum + graphRectOverlapArea(rect, obstacle, 5), 0);
        const score = nodeOverlap * 100 + labelOverlap * 20 + Math.abs(t - 0.5) * 60 + Math.abs(offset) * 0.35;
        candidates.push({ x, y, rect, score, clear: nodeOverlap === 0 && labelOverlap === 0 });
      }
    }
    candidates.sort((a, b) => Number(b.clear) - Number(a.clear) || a.score - b.score);
    const placement = candidates[0] || {
      ...graphCubicPoint(edge, 0.5),
      rect: { left: 0, right: width, top: 0, bottom: height }
    };
    if (!candidates.length) {
      placement.rect = { left: placement.x - width / 2, right: placement.x + width / 2, top: placement.y - height / 2, bottom: placement.y + height / 2 };
    }
    labelObstacles.push(placement.rect);
    return placement;
  }

  function placeGraphBackwardEdgeLabel(edge, width, layout, nodeObstacles, labelObstacles) {
    const height = 22;
    const candidates = [0.5, 0.4, 0.6, 0.3, 0.7].map((t) => {
      const x = edge.x1 + (edge.x2 - edge.x1) * t;
      const y = edge.routeY;
      const rect = { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 };
      const nodeOverlap = nodeObstacles.reduce((sum, obstacle) => sum + graphRectOverlapArea(rect, obstacle, 7), 0);
      const labelOverlap = labelObstacles.reduce((sum, obstacle) => sum + graphRectOverlapArea(rect, obstacle, 5), 0);
      return { x, y, rect, score: nodeOverlap * 100 + labelOverlap * 20 + Math.abs(t - 0.5) * 60, clear: nodeOverlap === 0 && labelOverlap === 0 };
    }).filter((candidate) => candidate.rect.left >= 8 && candidate.rect.right <= layout.width - 8 && candidate.rect.top >= 8);
    candidates.sort((a, b) => Number(b.clear) - Number(a.clear) || a.score - b.score);
    const placement = candidates[0] || { x: (edge.x1 + edge.x2) / 2, y: edge.routeY };
    placement.rect ||= { left: placement.x - width / 2, right: placement.x + width / 2, top: placement.y - height / 2, bottom: placement.y + height / 2 };
    labelObstacles.push(placement.rect);
    return placement;
  }

  function renderGraph() {
    const nodes = sortedNodes();
    const restoreNodeFocus = els.graphDialog.open && document.activeElement?.closest?.(".graph-node") ? graphFocusedNodeId : null;
    if (!nodes.some((node) => node.id === graphFocusedNodeId)) graphFocusedNodeId = currentNode()?.id || selectedNode()?.id || nodes[0]?.id || null;
    els.graphSvg.replaceChildren();
    els.graphEmpty.hidden = nodes.length > 0;
    els.graphCanvas.hidden = nodes.length === 0;
    const selected = selectedNode();
    const selectedBookPage = selected ? resolveNodeBookPage(selected) : null;
    els.graphSelectionLabel.textContent = selected ? `已选中：${nodeLabel(selected)}${selectedBookPage ? ` · 书中第 ${selectedBookPage} 页` : ""}` : "尚未选中节点";
    els.graphJumpButton.disabled = !selected || !pdfDocument;
    els.graphZoomLabel.textContent = graphScale < 0.01 ? "<1%" : `${Math.round(graphScale * 100)}%`;
    els.graphZoomOutButton.disabled = !nodes.length || graphScale <= GRAPH_MIN_SCALE;
    els.graphZoomInButton.disabled = !nodes.length || graphScale >= GRAPH_MAX_SCALE;
    els.graphFitButton.disabled = !nodes.length;
    if (!nodes.length) {
      graphNodePositions = new Map();
      els.graphSearchHint.textContent = "还没有可搜索的节点";
      return;
    }

    const layout = graphLayout(nodes);
    graphNodePositions = new Map(nodes.map((node) => {
      const position = layout.positions.get(node.id);
      return [node.id, { x: position.x + layout.nodeWidth / 2, y: position.y + layout.nodeHeight / 2 }];
    }));
    const graphQuery = els.graphNodeSearch.value.trim().toLocaleLowerCase();
    const graphMatches = graphQuery ? nodes.filter((node) => nodeMatchesQuery(node, graphQuery)) : nodes;
    const graphMatchIds = new Set(graphMatches.map((node) => node.id));
    els.graphSearchHint.textContent = graphQuery ? `${graphMatches.length} 个匹配节点` : "输入编号、名称、标签、备注或书中页码";
    const scaledWidth = Math.max(1, Math.round(layout.width * graphScale));
    const scaledHeight = Math.max(1, Math.round(layout.height * graphScale));
    els.graphSvg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
    els.graphSvg.setAttribute("width", String(scaledWidth));
    els.graphSvg.setAttribute("height", String(scaledHeight));
    els.graphSvg.style.width = `${scaledWidth}px`;
    els.graphSvg.style.height = `${scaledHeight}px`;

    const defs = svgElement("defs");
    const marker = svgElement("marker", { id: "graphArrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
    marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "graph-arrow" }));
    defs.append(marker);
    els.graphSvg.append(defs);

    const edges = svgElement("g", { class: "graph-edges" });
    const edgeLabels = svgElement("g", { class: "graph-edge-labels" });
    const graphEdges = [];
    for (const source of nodes) {
      const start = layout.positions.get(source.id);
      source.choices.forEach((choice, choiceIndex) => {
        const target = state.nodes[choice.targetNodeId];
        const end = target ? layout.positions.get(target.id) : null;
        if (!end) return;
        graphEdges.push({
          key: graphEdgeIdentity(source.id, choiceIndex),
          source, target, choice, choiceIndex, start, end, sourceOffset: 0, targetOffset: 0
        });
      });
    }
    const outgoingEdges = new Map();
    const incomingEdges = new Map();
    for (const edge of graphEdges) {
      if (!outgoingEdges.has(edge.source.id)) outgoingEdges.set(edge.source.id, []);
      if (!incomingEdges.has(edge.target.id)) incomingEdges.set(edge.target.id, []);
      outgoingEdges.get(edge.source.id).push(edge);
      incomingEdges.get(edge.target.id).push(edge);
    }
    for (const group of outgoingEdges.values()) {
      group.sort((a, b) => a.end.y - b.end.y || a.target.id.localeCompare(b.target.id, "zh-CN", { numeric: true }));
      group.forEach((edge, index) => { edge.sourceOffset = graphPortOffset(index, group.length); });
    }
    for (const group of incomingEdges.values()) {
      group.sort((a, b) => a.start.y - b.start.y || a.source.id.localeCompare(b.source.id, "zh-CN", { numeric: true }));
      group.forEach((edge, index) => { edge.targetOffset = graphPortOffset(index, group.length); });
    }
    for (const edge of graphEdges) {
      edge.x1 = edge.start.x + layout.nodeWidth;
      edge.y1 = edge.start.y + layout.nodeHeight / 2 + edge.sourceOffset;
      edge.x2 = edge.end.x;
      edge.y2 = edge.end.y + layout.nodeHeight / 2 + edge.targetOffset;
      edge.backward = layout.backwardLanes.has(edge.key);
      if (edge.backward) edge.routeY = 24 + layout.backwardLanes.get(edge.key) * layout.backwardLaneGap;
      const bend = Math.max(54, Math.abs(edge.x2 - edge.x1) * 0.45);
      edge.c1x = edge.x1 + bend;
      edge.c1y = edge.y1;
      edge.c2x = edge.x2 - bend;
      edge.c2y = edge.y2;
    }
    graphEdges.sort((a, b) => Math.abs(a.x2 - a.x1) - Math.abs(b.x2 - b.x1) || a.source.id.localeCompare(b.source.id, "zh-CN", { numeric: true }) || a.choiceIndex - b.choiceIndex);
    const nodeObstacles = nodes.map((node) => {
      const position = layout.positions.get(node.id);
      return { left: position.x, right: position.x + layout.nodeWidth, top: position.y, bottom: position.y + layout.nodeHeight };
    });
    const labelObstacles = [];
    for (const edge of graphEdges) {
      const { source, target, choice } = edge;
      const pathData = edge.backward
        ? `M ${edge.x1} ${edge.y1} C ${edge.x1 + 38} ${edge.y1}, ${edge.x1 + 38} ${edge.routeY}, ${edge.x1} ${edge.routeY} L ${edge.x2} ${edge.routeY} C ${edge.x2 - 38} ${edge.routeY}, ${edge.x2 - 38} ${edge.y2}, ${edge.x2} ${edge.y2}`
        : `M ${edge.x1} ${edge.y1} C ${edge.c1x} ${edge.c1y}, ${edge.c2x} ${edge.c2y}, ${edge.x2} ${edge.y2}`;
      const path = svgElement("path", {
        d: pathData,
        class: `graph-edge${edge.backward ? " graph-edge-backward" : ""}`, "marker-end": "url(#graphArrow)",
        "data-source-node-id": source.id, "data-target-node-id": target.id
      });
      const title = svgElement("title");
      title.textContent = `${nodeLabel(source)} — ${choice.label} → ${nodeLabel(target)}`;
      path.append(title);
      edges.append(path);
      const displayLabel = choice.label.length > 14 ? `${choice.label.slice(0, 13)}…` : choice.label;
      const labelWidth = Math.min(118, Math.max(38, Array.from(displayLabel).length * 7.2 + 16));
      const placement = edge.backward
        ? placeGraphBackwardEdgeLabel(edge, labelWidth, layout, nodeObstacles, labelObstacles)
        : placeGraphEdgeLabel(edge, labelWidth, layout, nodeObstacles, labelObstacles);
      const labelGroup = svgElement("g", {
        class: "graph-edge-label",
        transform: `translate(${placement.x} ${placement.y})`,
        "data-source-node-id": source.id, "data-target-node-id": target.id
      });
      const labelTitle = svgElement("title");
      labelTitle.textContent = choice.label;
      labelGroup.append(
        svgElement("rect", { x: -labelWidth / 2, y: -11, width: labelWidth, height: 22, rx: 8 }),
        svgElement("text", { x: 0, y: 4, "text-anchor": "middle" }),
        labelTitle
      );
      labelGroup.querySelector("text").textContent = displayLabel;
      edgeLabels.append(labelGroup);
    }
    els.graphSvg.append(edges, edgeLabels);

    const nodeGroup = svgElement("g", { class: "graph-nodes" });
    for (const node of nodes) {
      const position = layout.positions.get(node.id);
      const classes = ["graph-node", `status-${node.status}`];
      if (node.id === state.selectedNodeId) classes.push("selected");
      if (node.id === state.currentNodeId) classes.push("current");
      if (node.visited) classes.push("visited");
      if (node.ending) classes.push("ending");
      if (graphQuery && graphMatchIds.has(node.id)) classes.push("search-match");
      if (graphQuery && !graphMatchIds.has(node.id)) classes.push("search-muted");
      const graphTraits = [node.visited ? "已走过" : "", node.ending ? "结局" : ""].filter(Boolean);
      const group = svgElement("g", {
        class: classes.join(" "), transform: `translate(${position.x} ${position.y})`,
        role: "button", tabindex: node.id === graphFocusedNodeId ? 0 : -1, "data-node-id": node.id,
        "data-graph-level": layout.levels.get(node.id), "data-graph-order": layout.orders.get(node.id),
        "aria-label": `选择${nodeLabel(node)}${resolveNodeBookPage(node) ? `，书中第 ${resolveNodeBookPage(node)} 页` : ""}${graphTraits.length ? `，${graphTraits.join("，")}` : ""}`
      });
      group.append(svgElement("rect", { width: layout.nodeWidth, height: layout.nodeHeight, rx: 13 }));
      const idText = svgElement("text", { x: 14, y: 23, class: "graph-node-id" });
      idText.textContent = node.id;
      const titleText = svgElement("text", { x: 14, y: 46, class: "graph-node-title" });
      const rawTitle = node.title || `节点 ${node.id}`;
      titleText.textContent = rawTitle.length > 18 ? `${rawTitle.slice(0, 17)}…` : rawTitle;
      const pageText = svgElement("text", { x: layout.nodeWidth - 13, y: 23, class: "graph-node-page", "text-anchor": "end" });
      const graphBookPage = resolveNodeBookPage(node);
      pageText.textContent = graphBookPage ? `书 ${graphBookPage}` : "书页 —";
      group.append(idText, titleText, pageText);
      if (graphTraits.length) {
        const traitText = svgElement("text", { x: 14, y: 66, class: "graph-node-traits" });
        traitText.textContent = graphTraits.join(" · ");
        group.append(traitText);
      }
      group.addEventListener("click", () => selectGraphNode(node.id));
      group.addEventListener("keydown", (event) => handleGraphNodeKeydown(event, node.id));
      nodeGroup.append(group);
    }
    els.graphSvg.append(nodeGroup);
    if (restoreNodeFocus) requestAnimationFrame(() => focusGraphNode(restoreNodeFocus, { center: false }));
  }

  function graphNodeElement(id) {
    if (id == null) return null;
    return Array.from(els.graphSvg.querySelectorAll(".graph-node")).find((element) => element.dataset.nodeId === String(id)) || null;
  }

  function focusGraphNode(id, options = {}) {
    const element = graphNodeElement(id);
    if (!element) return;
    graphFocusedNodeId = String(id);
    for (const node of els.graphSvg.querySelectorAll(".graph-node")) node.setAttribute("tabindex", node === element ? "0" : "-1");
    element.focus({ preventScroll: true });
    if (options.center === false) return;
    const viewportRect = els.graphViewport.getBoundingClientRect();
    const nodeRect = element.getBoundingClientRect();
    els.graphViewport.scrollTo({
      left: Math.max(0, els.graphViewport.scrollLeft + nodeRect.left + nodeRect.width / 2 - viewportRect.left - viewportRect.width / 2),
      top: Math.max(0, els.graphViewport.scrollTop + nodeRect.top + nodeRect.height / 2 - viewportRect.top - viewportRect.height / 2),
      behavior: options.smooth ? "smooth" : "auto"
    });
  }

  function selectGraphNode(id, options = {}) {
    graphFocusedNodeId = String(id);
    selectNode(id);
    requestAnimationFrame(() => focusGraphNode(id, options));
  }

  function graphNeighborNodeId(id, key) {
    const origin = graphNodePositions.get(String(id));
    if (!origin) return null;
    const candidates = [];
    for (const [candidateId, point] of graphNodePositions) {
      if (candidateId === String(id)) continue;
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      const horizontal = key === "ArrowLeft" || key === "ArrowRight";
      const primary = key === "ArrowLeft" ? -dx : key === "ArrowRight" ? dx : key === "ArrowUp" ? -dy : dy;
      if (primary <= 0) continue;
      const secondary = Math.abs(horizontal ? dy : dx);
      candidates.push({ id: candidateId, score: primary + secondary * 2, primary, secondary });
    }
    candidates.sort((a, b) => a.score - b.score || a.secondary - b.secondary || a.primary - b.primary);
    return candidates[0]?.id || null;
  }

  function handleGraphNodeKeydown(event, id) {
    let targetId = null;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) targetId = graphNeighborNodeId(id, event.key);
    else if (event.key === "Home") targetId = sortedNodes()[0]?.id || null;
    else if (event.key === "End") targetId = sortedNodes().at(-1)?.id || null;
    else if (event.key === "Enter" || event.key === " ") targetId = id;
    else return;
    event.preventDefault();
    event.stopPropagation();
    if (targetId) selectGraphNode(targetId, { smooth: true });
  }

  function selectFirstGraphSearchMatch() {
    const query = els.graphNodeSearch.value.trim().toLocaleLowerCase();
    const match = sortedNodes().find((node) => !query || nodeMatchesQuery(node, query));
    if (!match) {
      showToast("关系图中没有匹配的节点");
      return;
    }
    selectGraphNode(match.id, { smooth: true });
  }

  function openGraph() {
    graphScale = 1;
    els.graphNodeSearch.value = "";
    graphFocusedNodeId = currentNode()?.id || selectedNode()?.id || sortedNodes()[0]?.id || null;
    els.graphDialog.showModal();
    renderGraph();
    requestAnimationFrame(() => {
      if (graphFocusedNodeId) focusGraphNode(graphFocusedNodeId);
      else els.closeGraphButton.focus();
    });
  }

  function fitGraph() {
    if (!sortedNodes().length) return;
    const viewBox = els.graphSvg.viewBox.baseVal;
    const availableWidth = Math.max(240, els.graphViewport.clientWidth - 36);
    const availableHeight = Math.max(180, els.graphViewport.clientHeight - 36);
    graphScale = Math.min(1, availableWidth / viewBox.width, availableHeight / viewBox.height);
    renderGraph();
    els.graphViewport.scrollTo({ left: 0, top: 0 });
  }

  function changeGraphZoom(delta) {
    const previousScale = graphScale;
    const centerX = els.graphViewport.scrollLeft + els.graphViewport.clientWidth / 2;
    const centerY = els.graphViewport.scrollTop + els.graphViewport.clientHeight / 2;
    graphScale = Math.min(GRAPH_MAX_SCALE, Math.max(GRAPH_MIN_SCALE, Math.round((graphScale + delta) * 100) / 100));
    renderGraph();
    const ratio = graphScale / previousScale;
    els.graphViewport.scrollTo({
      left: Math.max(0, centerX * ratio - els.graphViewport.clientWidth / 2),
      top: Math.max(0, centerY * ratio - els.graphViewport.clientHeight / 2)
    });
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
      page.textContent = `阅读页 ${readingPageForPhysicalPage(entry.pdfPage)}`;
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
      els.nodePdfPageInput.value = node.pdfPage ? readingPageForPhysicalPage(node.pdfPage) : "";
      els.nodeStatusInput.value = node.status;
      els.nodeTagsInput.value = node.tags;
      els.nodeEndingInput.checked = node.ending;
      els.nodeVisitedInput.checked = node.visited;
      els.nodeNoteInput.value = node.note;
    } else {
      const suggestedBookPage = readingPageForPhysicalPage(state.currentPdfPage) - state.offset;
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
    const fixedReadingPage = optionalPositiveInteger(els.nodePdfPageInput.value);
    const pdfPage = fixedReadingPage ? physicalPageForReadingPage(fixedReadingPage) : null;
    if (!bookPage && !pdfPage) {
      els.nodeFormError.textContent = "非数字节点需要填写书中页码或固定阅读页。";
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
      ending: els.nodeEndingInput.checked,
      visited: els.nodeVisitedInput.checked,
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
    saveState();
    els.nodeDialog.close();
    render();
    showToast(previous ? "节点已更新" : "节点已添加");
  }

  function toggleSelectedNodeProperty(property) {
    const node = selectedNode();
    if (!node || !["ending", "visited"].includes(property)) return;
    node[property] = !node[property];
    saveState();
    closeNodeActionMenu();
    render();
    if (property === "ending") showToast(node.ending ? "已标记为结局节点" : "已取消结局标记");
    else showToast(node.visited ? "已标记为走过" : "已标记为未走过");
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

  function choiceTargetLabel(node) {
    const bookPage = resolveNodeBookPage(node);
    return `${nodeLabel(node)}${bookPage ? ` · 书中第 ${bookPage} 页` : ` · 阅读页 ${readingPageForPhysicalPage(resolveNodePage(node))}`}`;
  }

  function renderChoiceTargetOptions(preferredId = null) {
    const query = els.choiceTargetSearch.value.trim().toLocaleLowerCase();
    const currentId = preferredId || els.choiceTarget.value;
    const matches = choiceTargetCandidates.filter((node) => {
      if (!query) return true;
      const bookPage = resolveNodeBookPage(node);
      return [
        node.id, node.title, node.tags, node.note, STATUS_LABELS[node.status],
        bookPage, bookPage ? `书中第 ${bookPage} 页` : "",
        node.ending ? "结局 结局节点" : "", node.visited ? "已走过 已访问" : ""
      ].filter(Boolean).join(" ").toLocaleLowerCase().includes(query);
    });
    els.choiceTarget.replaceChildren(...matches.map((node) => {
      const option = document.createElement("option");
      option.value = node.id;
      option.textContent = choiceTargetLabel(node);
      return option;
    }));
    if (matches.some((node) => node.id === currentId)) els.choiceTarget.value = currentId;
    els.choiceTarget.disabled = matches.length === 0;
    els.saveChoiceButton.disabled = matches.length === 0;
    els.choiceTargetHint.textContent = matches.length ? `找到 ${matches.length} 个目标节点` : "没有匹配的目标节点，请换个关键词";
    els.choiceTargetHint.dataset.empty = String(matches.length === 0);
  }

  function openChoiceForm(choice = null) {
    const node = selectedNode();
    choiceTargetCandidates = sortedNodes().filter((item) => item.id !== node?.id);
    if (!choiceTargetCandidates.length) {
      showToast("请先添加至少一个目标节点");
      return;
    }
    editingChoiceId = choice?.id || null;
    els.choiceLabel.value = choice?.label || "";
    els.choiceTargetSearch.value = "";
    renderChoiceTargetOptions(choice && state.nodes[choice.targetNodeId] ? choice.targetNodeId : null);
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
    choiceTargetCandidates = [];
    els.choiceTargetHint.textContent = "";
    els.choiceForm.hidden = true;
    renderCurrentNode();
    showToast(existing ? "跳转关系已更新" : "跳转关系已添加");
  }

  function handleJump(event) {
    event.preventDefault();
    const value = els.jumpInput.value.trim();
    let navigated = false;
    if (state.nodes[value]) {
      navigated = navigateToNode(value);
    } else if (/^\d+$/.test(value)) {
      const bookPage = Number(value);
      const physicalPage = physicalPageForBookPage(bookPage);
      if (physicalPage) navigated = navigateToPage(physicalPage);
      else showToast(`这本书没有书中第 ${bookPage} 页`);
    } else {
      showToast("找不到该节点；直接跳页时请输入数字");
    }
    if (navigated) {
      els.jumpInput.blur();
      els.pdfStage.focus({ preventScroll: true });
    } else {
      els.jumpInput.select();
    }
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
      if (pdfDocument) state.currentPdfPage = normalizePhysicalPage(Math.min(state.currentPdfPage, pdfDocument.numPages));
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

  function toggleSidebar() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    saveState();
    renderLayout();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderPdfPage(), 190);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) els.pdfStage.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  function cancelChoiceForm() {
    if (els.choiceForm.hidden) return false;
    editingChoiceId = null;
    choiceTargetCandidates = [];
    els.choiceTargetHint.textContent = "";
    els.choiceForm.hidden = true;
    els.choiceForm.reset();
    els.addChoiceButton.focus();
    return true;
  }

  function openShortcutDialog() {
    closeMoreMenu();
    closeNodeActionMenu();
    els.shortcutDialog.showModal();
    setTimeout(() => els.closeShortcutDialogButton.focus(), 0);
  }

  function activateChoiceShortcut(index) {
    if (!pdfDocument) {
      showToast("请先选择 PDF");
      return;
    }
    const node = selectedNode();
    const choice = node?.choices[index];
    if (!choice) {
      showToast(node ? `这个节点没有第 ${index + 1} 个选项` : "请先选中一个节点");
      return;
    }
    if (!state.nodes[choice.targetNodeId]) {
      showToast(`选项“${choice.label}”的目标节点已不存在`);
      return;
    }
    navigateToNode(choice.targetNodeId);
  }

  function firstVisibleNodeButton() {
    return els.nodeList.querySelector(".node-item");
  }

  function focusNodeSearch() {
    if (state.sidebarCollapsed) {
      state.sidebarCollapsed = false;
      saveState();
      renderLayout();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => renderPdfPage(), 190);
    }
    els.nodeSearch.focus();
    els.nodeSearch.select();
  }

  function isTextEntry(target) {
    return Boolean(target.closest?.("input, textarea, select, [contenteditable='true']"));
  }

  function handleFormFieldNavigation(event, form) {
    if (event.key !== "Enter" || event.isComposing || event.keyCode === 229 || event.altKey) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      form.requestSubmit();
      return;
    }
    const field = event.target.closest?.("input:not([type='hidden']), textarea, select");
    if (!field || (field.matches("textarea") && !event.shiftKey)) return;
    const fields = Array.from(form.querySelectorAll("input:not([type='hidden']), textarea, select"))
      .filter((item) => !item.disabled && !item.hidden);
    const currentIndex = fields.indexOf(field);
    if (currentIndex < 0) return;
    const targetIndex = currentIndex + (event.shiftKey ? -1 : 1);
    const nextField = fields[targetIndex];
    event.preventDefault();
    if (nextField) nextField.focus({ preventScroll: false });
    else if (!event.shiftKey) form.requestSubmit();
  }

  els.pdfInput.addEventListener("change", () => handlePdfFile(els.pdfInput.files[0]));
  els.importInput.addEventListener("change", () => importData(els.importInput.files[0]));
  els.jumpForm.addEventListener("submit", handleJump);
  els.previousPageButton.addEventListener("click", () => navigateByPage(-1));
  els.nextPageButton.addEventListener("click", () => navigateByPage(1));
  els.backButton.addEventListener("click", goBack);
  els.zoomOutButton.addEventListener("click", () => changeZoom(-0.25));
  els.zoomInButton.addEventListener("click", () => changeZoom(0.25));
  els.sidebarToggleButton.addEventListener("click", toggleSidebar);
  els.offsetInput.addEventListener("change", () => {
    state.offset = asInteger(els.offsetInput.value, 0);
    saveState();
    render();
    showToast("页码偏移已保存");
  });
  els.fullscreenButton.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderPdfPage(), 120);
  });
  els.moreButton.addEventListener("click", () => {
    const willOpen = els.moreMenu.hidden;
    els.moreMenu.hidden = !willOpen;
    els.moreButton.setAttribute("aria-expanded", String(willOpen));
  });
  els.shortcutHelpButton.addEventListener("click", openShortcutDialog);
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
  els.toggleVisitedNodeButton.addEventListener("click", () => toggleSelectedNodeProperty("visited"));
  els.toggleEndingNodeButton.addEventListener("click", () => toggleSelectedNodeProperty("ending"));
  els.deleteSelectedNodeButton.addEventListener("click", () => {
    const node = selectedNode();
    if (node) requestDeleteNode(node.id);
  });
  els.openGraphButton.addEventListener("click", openGraph);
  els.closeGraphButton.addEventListener("click", () => els.graphDialog.close());
  els.graphZoomOutButton.addEventListener("click", () => changeGraphZoom(-0.2));
  els.graphZoomInButton.addEventListener("click", () => changeGraphZoom(0.2));
  els.graphFitButton.addEventListener("click", fitGraph);
  els.graphNodeSearch.addEventListener("input", renderGraph);
  els.graphNodeSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.graphNodeSearch.value) {
      event.preventDefault();
      event.stopPropagation();
      els.graphNodeSearch.value = "";
      renderGraph();
      return;
    }
    if (event.key !== "Enter" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    selectFirstGraphSearchMatch();
  });
  els.graphJumpButton.addEventListener("click", () => {
    const node = selectedNode();
    if (!node) return;
    navigateToNode(node.id);
    els.graphDialog.close();
  });
  els.nodeSearch.addEventListener("input", renderNodeList);
  els.nodeSearch.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      const first = firstVisibleNodeButton();
      if (first) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key !== "Enter") return;
    const first = firstVisibleNodeButton();
    if (!first) return;
    event.preventDefault();
    const id = first.dataset.nodeId;
    selectNode(id);
    if (event.ctrlKey || event.metaKey) navigateToNode(id);
  });
  els.nodeList.addEventListener("keydown", (event) => {
    const item = event.target.closest?.(".node-item");
    if (!item) return;
    const items = Array.from(els.nodeList.querySelectorAll(".node-item"));
    const index = items.indexOf(item);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      navigateToNode(item.dataset.nodeId);
    }
  });
  els.nodeForm.addEventListener("submit", saveNodeFromForm);
  els.nodeForm.addEventListener("keydown", (event) => handleFormFieldNavigation(event, els.nodeForm));
  els.deleteNodeButton.addEventListener("click", deleteCurrentEditingNode);
  els.closeNodeDialogButton.addEventListener("click", () => els.nodeDialog.close());
  els.cancelNodeButton.addEventListener("click", () => els.nodeDialog.close());
  els.addChoiceButton.addEventListener("click", openChoiceForm);
  els.choiceTargetSearch.addEventListener("input", () => renderChoiceTargetOptions());
  els.cancelChoiceButton.addEventListener("click", cancelChoiceForm);
  els.choiceForm.addEventListener("submit", saveChoice);
  els.choiceForm.addEventListener("keydown", (event) => handleFormFieldNavigation(event, els.choiceForm));
  els.closeShortcutDialogButton.addEventListener("click", () => els.shortcutDialog.close());
  els.toastAction.addEventListener("click", () => {
    if (undoAction) undoAction();
    els.toast.hidden = true;
    undoAction = null;
  });
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const textEntry = isTextEntry(event.target);

    if (event.key === "Escape") {
      if (els.nodeDialog.open || els.graphDialog.open || els.shortcutDialog.open) return;
      if (!els.nodeActionMenu.hidden) {
        event.preventDefault();
        closeNodeActionMenu();
        els.nodeMoreButton.focus();
        return;
      }
      if (!els.moreMenu.hidden) {
        event.preventDefault();
        closeMoreMenu();
        els.moreButton.focus();
        return;
      }
      if (cancelChoiceForm()) {
        event.preventDefault();
        return;
      }
      if (textEntry && !els.nodeDialog.open) {
        event.target.blur();
        els.pdfStage.focus?.({ preventScroll: true });
      }
      return;
    }

    if (event.defaultPrevented || els.shortcutDialog.open) return;

    if (els.graphDialog.open) {
      if (textEntry) return;
      if (event.key === "/" && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        els.graphNodeSearch.focus();
        els.graphNodeSearch.select();
      } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        const targetId = graphNeighborNodeId(graphFocusedNodeId, event.key);
        if (targetId) selectGraphNode(targetId, { smooth: true });
      } else if ((event.key === "Home" || event.key === "End") && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        const nodes = sortedNodes();
        const targetId = event.key === "Home" ? nodes[0]?.id : nodes.at(-1)?.id;
        if (targetId) selectGraphNode(targetId, { smooth: true });
      } else if (key === "j" && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const node = selectedNode();
        if (node && pdfDocument) {
          event.preventDefault();
          navigateToNode(node.id);
          els.graphDialog.close();
        }
      } else if ((event.key === "+" || event.key === "=") && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        changeGraphZoom(0.2);
      } else if (event.key === "-" && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        changeGraphZoom(-0.2);
      } else if (event.key === "0" && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        fitGraph();
      }
      return;
    }

    if (els.nodeDialog.open) return;

    if ((event.ctrlKey || event.metaKey) && key === "k") {
      event.preventDefault();
      els.jumpInput.focus();
      els.jumpInput.select();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && key === "z" && undoAction && !textEntry) {
      event.preventDefault();
      undoAction();
      els.toast.hidden = true;
      undoAction = null;
      return;
    }

    if (textEntry) return;

    if (event.altKey && event.key === "ArrowLeft") {
      event.preventDefault();
      goBack();
      return;
    }

    if (event.key === "?" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      openShortcutDialog();
      return;
    }

    if (event.shiftKey && event.code === "Space") {
      if (event.target.closest?.("button, a, summary, [role='button']")) return;
      event.preventDefault();
      if (pdfDocument && readingPageForPhysicalPage(state.currentPdfPage) > 1) navigateByPage(-1);
      return;
    }

    if (event.shiftKey && key === "e" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      toggleSelectedNodeProperty("ending");
      return;
    }

    if ((event.key === "+" || event.key === "=") && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      changeZoom(0.25);
      return;
    }
    if (event.key === "-" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      changeZoom(-0.25);
      return;
    }

    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
      event.preventDefault();
      if (pdfDocument && readingPageForPhysicalPage(state.currentPdfPage) > 1) navigateByPage(-1);
      return;
    }
    if (["ArrowRight", "ArrowDown", "PageDown"].includes(event.key)) {
      event.preventDefault();
      if (pdfDocument && readingPageForPhysicalPage(state.currentPdfPage) < readingPageCount()) navigateByPage(1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      if (pdfDocument) navigateToReadingPage(1);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      if (pdfDocument) navigateToReadingPage(readingPageCount());
      return;
    }
    if (event.code === "Space") {
      if (event.target.closest?.("button, a, summary, [role='button']")) return;
      event.preventDefault();
      if (pdfDocument && readingPageForPhysicalPage(state.currentPdfPage) < readingPageCount()) navigateByPage(1);
      return;
    }

    if (/^[1-9]$/.test(event.key) || event.key === "0") {
      event.preventDefault();
      activateChoiceShortcut(event.key === "0" ? 9 : Number(event.key) - 1);
      return;
    }

    const selected = selectedNode();
    switch (key) {
      case "b":
        event.preventDefault();
        goBack();
        break;
      case "g":
        event.preventDefault();
        els.jumpInput.focus();
        els.jumpInput.select();
        break;
      case "/":
        event.preventDefault();
        focusNodeSearch();
        break;
      case "j":
        event.preventDefault();
        if (selected && pdfDocument) navigateToNode(selected.id);
        else showToast(selected ? "请先选择 PDF" : "请先选中一个节点");
        break;
      case "n":
        event.preventDefault();
        if (pdfDocument) openNodeDialog();
        else showToast("请先选择 PDF");
        break;
      case "e":
        event.preventDefault();
        if (selected) openNodeDialog(selected);
        else showToast("请先选中一个节点");
        break;
      case "c":
        event.preventDefault();
        if (selected) openChoiceForm();
        else showToast("请先选中一个节点");
        break;
      case "v":
        event.preventDefault();
        if (selected) toggleSelectedNodeProperty("visited");
        else showToast("请先选中一个节点");
        break;
      case "m":
        event.preventDefault();
        openGraph();
        break;
      case "s":
        event.preventDefault();
        toggleSidebar();
        break;
      case "f":
        event.preventDefault();
        toggleFullscreen();
        break;
      case "o":
        event.preventDefault();
        els.pdfInput.click();
        break;
      case "delete":
        event.preventDefault();
        if (selected) requestDeleteNode(selected.id);
        else showToast("请先选中一个节点");
        break;
      default:
        break;
    }
  });

  window.addEventListener("resize", () => {
    if (!pdfDocument) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderPdfPage(), 120);
  });

  render();
})();
