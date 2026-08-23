window.__ModuleLoader__.load({
	id: "dsh-plugin-aomerag",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/AomeragSection.tsx
		const FIELDS = [
			{
				key: "chunkTarget",
				kind: "number",
				labelKey: "field.chunkTarget",
				hintKey: "hint.chunk",
				min: 100
			},
			{
				key: "chunkMax",
				kind: "number",
				labelKey: "field.chunkMax",
				hintKey: "hint.chunk",
				min: 200
			},
			{
				key: "chunkOverlap",
				kind: "number",
				labelKey: "field.chunkOverlap",
				hintKey: "hint.chunk",
				min: 0
			},
			{
				key: "topK",
				kind: "number",
				labelKey: "field.topK",
				hintKey: "hint.search",
				min: 1
			},
			{
				key: "rrfK",
				kind: "number",
				labelKey: "field.rrfK",
				hintKey: "hint.search",
				min: 1
			},
			{
				key: "embedBatchSize",
				kind: "number",
				labelKey: "field.embedBatchSize",
				hintKey: "hint.batch",
				min: 1
			},
			{
				key: "ollamaBaseUrl",
				kind: "text",
				labelKey: "field.ollamaBaseUrl",
				hintKey: "hint.ollama"
			},
			{
				key: "embedModel",
				kind: "text",
				labelKey: "field.embedModel",
				hintKey: "hint.model"
			},
			{
				key: "mdDir",
				kind: "text",
				labelKey: "field.mdDir",
				hintKey: "hint.mdDir",
				restart: true
			},
			{
				key: "dbPath",
				kind: "text",
				labelKey: "field.dbPath",
				hintKey: "hint.dbPath",
				restart: true
			}
		];
		const styles = {
			section: {
				display: "flex",
				flexDirection: "column",
				gap: "12px",
				maxWidth: "560px"
			},
			intro: {
				fontSize: "13px",
				opacity: .8,
				margin: 0
			},
			row: {
				display: "flex",
				flexDirection: "column",
				gap: "3px"
			},
			checkRow: {
				display: "flex",
				alignItems: "center",
				gap: "8px"
			},
			label: {
				fontSize: "13px",
				fontWeight: 600
			},
			hint: {
				fontSize: "12px",
				opacity: .65,
				margin: 0
			},
			restartBadge: {
				fontSize: "11px",
				color: "#b45309",
				fontWeight: 600,
				marginLeft: "6px"
			},
			input: {
				width: "320px",
				padding: "5px 8px",
				fontSize: "13px"
			},
			numberInput: {
				width: "180px",
				padding: "5px 8px",
				fontSize: "13px"
			},
			divider: {
				border: 0,
				borderTop: "1px solid rgba(128,128,128,0.25)",
				margin: "10px 0"
			},
			kvGrid: {
				display: "grid",
				gridTemplateColumns: "auto 1fr",
				gap: "4px 14px",
				fontSize: "13px"
			},
			kvKey: { opacity: .7 },
			badge: {
				fontSize: "12px",
				padding: "1px 8px",
				borderRadius: "10px",
				background: "rgba(128,128,128,0.2)"
			},
			badgeBusy: {
				fontSize: "12px",
				padding: "1px 8px",
				borderRadius: "10px",
				background: "rgba(59,130,246,0.25)"
			},
			report: {
				fontSize: "13px",
				margin: 0
			},
			errors: {
				fontSize: "12px",
				opacity: .8,
				margin: "4px 0 0",
				whiteSpace: "pre-wrap"
			},
			btnRow: {
				display: "flex",
				gap: "8px",
				flexWrap: "wrap"
			},
			btn: {
				padding: "6px 14px",
				fontSize: "13px",
				cursor: "pointer"
			},
			btnDanger: {
				padding: "6px 14px",
				fontSize: "13px",
				cursor: "pointer",
				color: "#b91c1c",
				borderColor: "#b91c1c"
			},
			note: {
				fontSize: "12px",
				opacity: .65,
				margin: 0
			}
		};
		function AomeragSection({ t, tunable, status, command }) {
			if (t === void 0 || tunable === void 0 || status === void 0 || command === void 0) return null;
			const form = (0, react.useSyncExternalStore)((onChange) => tunable.subscribe(onChange), () => tunable.getSnapshot());
			const snap = (0, react.useSyncExternalStore)((onChange) => status.subscribe(onChange), () => status.getSnapshot());
			const cmd = (0, react.useSyncExternalStore)((onChange) => command.subscribe(onChange), () => command.getSnapshot());
			const writable = form.status === "ready" && form.writable;
			const values = form.value;
			const st = snap.value;
			const busy = cmd.value?.action !== void 0 && cmd.value.action !== "none";
			const [armed, setArmed] = (0, react.useState)(null);
			const onNumber = (key, min) => (e) => {
				const n = Number(e.target.value);
				if (Number.isFinite(n) && n >= min) tunable.set(key, n);
			};
			const onText = (key) => (e) => {
				if (e.target.value !== "") tunable.set(key, e.target.value);
			};
			const sendCommand = (action) => {
				command.set("action", action);
				command.set("nonce", Date.now());
				setArmed(null);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.intro,
						children: t("intro")
					}),
					form.status !== "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.note,
						children: t("readonly")
					}),
					FIELDS.map((f) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: styles.row,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: styles.label,
								children: [t(f.labelKey), f.restart === true && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: styles.restartBadge,
									children: ["⟳ ", t("restartNeeded")]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: f.kind === "number" ? styles.numberInput : styles.input,
								type: f.kind,
								min: f.min,
								disabled: !writable,
								value: values?.[f.key] ?? "",
								onChange: f.kind === "number" ? onNumber(f.key, f.min) : onText(f.key)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.hint,
								children: t(f.hintKey)
							})
						]
					}, f.key)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: styles.checkRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							disabled: !writable,
							checked: values?.syncOnStart ?? true,
							onChange: (e) => void tunable.set("syncOnStart", e.target.checked)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: styles.label,
							children: t("field.syncOnStart")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.hint,
						children: t("hint.syncOnStart")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("hr", { style: styles.divider }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: styles.label,
						children: t("status.title")
					}),
					st === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.note,
						children: t("loading")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.kvGrid,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.kvKey,
								children: t("status.docs")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: st.docs }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.kvKey,
								children: t("status.chunks")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: st.chunks }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.kvKey,
								children: t("status.lastSyncAt")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: st.syncing ? t("status.syncing") : st.lastSyncAt === "" ? t("status.never") : st.lastSyncAt }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.kvKey,
								children: t("status.dbSize")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [st.dbSizeMB, " MB"] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.kvKey,
								children: t("status.dbPath")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { fontSize: "12px" },
								children: st.dbPath
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.kvKey,
								children: t("status.model")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								st.model,
								" ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: st.syncing ? styles.badgeBusy : styles.badge,
									children: st.syncing ? t("status.syncing") : t("status.idle")
								})
							] })
						]
					}), (st.lastReport.added > 0 || st.lastReport.updated > 0 || st.lastReport.skipped > 0 || st.lastReport.removed > 0 || st.lastReport.failed > 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						style: styles.report,
						children: [
							t("report.title"),
							":",
							t("report.added"),
							" ",
							st.lastReport.added,
							" · ",
							t("report.updated"),
							" ",
							st.lastReport.updated,
							" · ",
							t("report.skipped"),
							" ",
							st.lastReport.skipped,
							" ·",
							" ",
							t("report.removed"),
							" ",
							st.lastReport.removed,
							" · ",
							t("report.failed"),
							" ",
							st.lastReport.failed
						]
					}), st.lastReport.failed > 0 && st.lastReport.errors.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						style: styles.errors,
						children: [
							t("report.errors"),
							":",
							"\n",
							st.lastReport.errors.join("\n")
						]
					})] })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("hr", { style: styles.divider }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: styles.label,
						children: t("btn.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.btnRow,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: styles.btn,
								disabled: !writable || busy,
								onClick: () => sendCommand("sync"),
								children: busy ? t("btn.busy") : t("btn.sync")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: armed === "rebuild" ? styles.btnDanger : styles.btn,
								disabled: !writable || busy,
								title: t("btn.confirmRebuild"),
								onClick: () => armed === "rebuild" ? sendCommand("rebuild") : setArmed("rebuild"),
								onBlur: () => setArmed(null),
								children: armed === "rebuild" ? t("btn.confirmRebuild") : t("btn.rebuild")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: armed === "clear" ? styles.btnDanger : styles.btn,
								disabled: !writable || busy,
								title: t("btn.confirmClear"),
								onClick: () => armed === "clear" ? sendCommand("clear") : setArmed("clear"),
								onBlur: () => setArmed(null),
								children: armed === "clear" ? t("btn.confirmClear") : t("btn.clear")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: styles.btn,
								disabled: !writable,
								onClick: () => sendCommand("openDir"),
								children: t("btn.openDir")
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const zh = {
			nav: "AomeRAG 知识库",
			intro: "检索与切片的行为参数,保存后立即生效(下次检索/同步使用新值)。",
			"field.chunkTarget": "切片目标长度(字符)",
			"field.chunkMax": "切片最大长度(字符)",
			"field.chunkOverlap": "切片重叠(字符)",
			"field.topK": "检索命中数 top_k",
			"field.rrfK": "RRF 融合常数 k",
			"field.embedBatchSize": "embedding 批大小",
			"field.ollamaBaseUrl": "Ollama 地址",
			"field.embedModel": "embedding 模型",
			"field.syncOnStart": "启动时自动同步",
			"field.mdDir": "知识目录(mdDir)",
			"field.dbPath": "库文件路径(dbPath)",
			"hint.chunk": "标题优先切分,超长段落按目标长度兜底,相邻窗口保留重叠。",
			"hint.search": "kb_search 每次返回的命中片段数;调用时可临时覆盖。",
			"hint.batch": "每次请求 Ollama 的文本条数;过大可能压垮本机模型。",
			"hint.ollama": "立即生效(重建客户端)。",
			"hint.model": "立即生效;换模型后建议重建索引(向量空间不同)。",
			"hint.syncOnStart": "插件启动时后台增量同步。",
			"hint.mdDir": "存放 .md 源文件的目录(递归扫描)。",
			"hint.dbPath": "SQLite 库文件;向量在同名 .lance 目录。",
			restartNeeded: "保存后需重启 dsh 生效",
			"status.title": "库状态",
			"status.docs": "文档数",
			"status.chunks": "chunk 数",
			"status.lastSyncAt": "最后同步",
			"status.dbPath": "库文件",
			"status.model": "模型",
			"status.dbSize": "库体积",
			"status.never": "(尚未同步)",
			"status.syncing": "同步中…",
			"status.idle": "空闲",
			"report.title": "最近同步报告",
			"report.added": "新增",
			"report.updated": "更新",
			"report.skipped": "跳过",
			"report.removed": "删除",
			"report.failed": "失败",
			"report.errors": "失败明细",
			"btn.title": "操作",
			"btn.sync": "立即同步",
			"btn.rebuild": "重建索引",
			"btn.clear": "清空库",
			"btn.openDir": "打开知识目录",
			"btn.confirmRebuild": "确认重建?(全量重切重嵌,大库耗时)",
			"btn.confirmClear": "确认清空?(删除全部已入库数据)",
			"btn.busy": "执行中…",
			readonly: "当前浏览器为远程连接,设置只读(settings 仅回环可写)。",
			loading: "读取中…"
		};
		const en = {
			nav: "AomeRAG Knowledge",
			intro: "Retrieval and chunking behavior. Saved values apply from the next search/sync.",
			"field.chunkTarget": "Chunk target length (chars)",
			"field.chunkMax": "Chunk max length (chars)",
			"field.chunkOverlap": "Chunk overlap (chars)",
			"field.topK": "Search top_k",
			"field.rrfK": "RRF fusion constant k",
			"field.embedBatchSize": "Embedding batch size",
			"field.ollamaBaseUrl": "Ollama URL",
			"field.embedModel": "Embedding model",
			"field.syncOnStart": "Sync on start",
			"field.mdDir": "Knowledge dir (mdDir)",
			"field.dbPath": "DB path (dbPath)",
			"hint.chunk": "Heading-first split; oversized sections fall back to fixed windows with overlap.",
			"hint.search": "Hits returned per kb_search call; overridable per call.",
			"hint.batch": "Texts per Ollama request; too large may overload a local model.",
			"hint.ollama": "Applies immediately (client rebuilt).",
			"hint.model": "Applies immediately; reindex recommended after switching (different vector space).",
			"hint.syncOnStart": "Background incremental sync when the plugin starts.",
			"hint.mdDir": "Directory holding .md sources (scanned recursively).",
			"hint.dbPath": "SQLite file; vectors live in the sibling .lance directory.",
			restartNeeded: "Takes effect after dsh restarts",
			"status.title": "Library status",
			"status.docs": "Docs",
			"status.chunks": "Chunks",
			"status.lastSyncAt": "Last sync",
			"status.dbPath": "DB file",
			"status.model": "Model",
			"status.dbSize": "Size",
			"status.never": "(never)",
			"status.syncing": "Syncing…",
			"status.idle": "Idle",
			"report.title": "Last sync report",
			"report.added": "added",
			"report.updated": "updated",
			"report.skipped": "skipped",
			"report.removed": "removed",
			"report.failed": "failed",
			"report.errors": "Failures",
			"btn.title": "Actions",
			"btn.sync": "Sync now",
			"btn.rebuild": "Rebuild index",
			"btn.clear": "Clear library",
			"btn.openDir": "Open knowledge dir",
			"btn.confirmRebuild": "Confirm rebuild? (full re-chunk & re-embed; slow on large libraries)",
			"btn.confirmClear": "Confirm clear? (deletes all indexed data)",
			"btn.busy": "Working…",
			readonly: "Remote browser: settings are read-only (settings writes are loopback-only).",
			loading: "Loading…"
		};
		//#endregion
		//#region src/client/index.ts
		const NS = "settings.aomerag";
		/** Required services:slots 注册 + settings wire(ui-settings 提供 settingsScope,transport 走 connection/remote)。 */
		const inject = [
			"slots",
			"locale",
			"connection",
			"remote",
			"settingsScope"
		];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-aomerag: dictionaries");
			const t = ctx.locale.bind(NS);
			const tunable = ctx.settingsScope.bind({ namespace: "aomerag" });
			const status = ctx.settingsScope.bind({ namespace: "aomerag-status" });
			const command = ctx.settingsScope.bind({ namespace: "aomerag-command" });
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "aomerag",
				order: 30,
				label: () => t("nav"),
				locale: NS,
				inject: () => ({
					t,
					tunable,
					status,
					command
				})
			}, () => (0, react.createElement)(AomeragSection, {
				t,
				tunable,
				status,
				command
			})));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map