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
				labelKey: "field.chunkTarget",
				hintKey: "hint.chunk",
				min: 100
			},
			{
				key: "chunkMax",
				labelKey: "field.chunkMax",
				hintKey: "hint.chunk",
				min: 200
			},
			{
				key: "chunkOverlap",
				labelKey: "field.chunkOverlap",
				hintKey: "hint.chunk",
				min: 0
			},
			{
				key: "topK",
				labelKey: "field.topK",
				hintKey: "hint.search",
				min: 1
			},
			{
				key: "rrfK",
				labelKey: "field.rrfK",
				hintKey: "hint.search",
				min: 1
			},
			{
				key: "embedBatchSize",
				labelKey: "field.embedBatchSize",
				hintKey: "hint.batch",
				min: 1
			}
		];
		const styles = {
			section: {
				display: "flex",
				flexDirection: "column",
				gap: "14px",
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
			label: {
				fontSize: "13px",
				fontWeight: 600
			},
			hint: {
				fontSize: "12px",
				opacity: .65,
				margin: 0
			},
			input: {
				width: "180px",
				padding: "5px 8px",
				fontSize: "13px"
			},
			divider: {
				border: 0,
				borderTop: "1px solid rgba(128,128,128,0.25)",
				margin: "10px 0"
			},
			opsItem: {
				fontSize: "13px",
				margin: 0
			},
			note: {
				fontSize: "12px",
				opacity: .65,
				margin: 0
			}
		};
		function AomeragSection({ t, host }) {
			if (t === void 0 || host === void 0) return null;
			const snap = (0, react.useSyncExternalStore)(host.subscribe, host.getSnapshot);
			const writable = snap.status === "ready" && snap.writable;
			const value = snap.value;
			const onField = (key, min) => (e) => {
				const n = Number(e.target.value);
				if (Number.isFinite(n) && n >= min) host.set(key, n);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.intro,
						children: t("intro")
					}),
					snap.status !== "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.note,
						children: t("readonly")
					}),
					FIELDS.map((f) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: styles.row,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.label,
								children: t(f.labelKey)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: styles.input,
								type: "number",
								min: f.min,
								disabled: !writable,
								value: value?.[f.key] ?? "",
								onChange: onField(f.key, f.min)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.hint,
								children: t(f.hintKey)
							})
						]
					}, f.key)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("hr", { style: styles.divider }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: styles.label,
						children: t("ops.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						style: styles.opsItem,
						children: ["• ", t("ops.status")]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						style: styles.opsItem,
						children: ["• ", t("ops.sync")]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("hr", { style: styles.divider }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.note,
						children: t("deployNote")
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
			"hint.chunk": "标题优先切分,超长段落按目标长度兜底,相邻窗口保留重叠。",
			"hint.search": "kb_search 每次返回的命中片段数;调用时可临时覆盖。",
			"hint.batch": "每次请求 Ollama 的文本条数;过大可能压垮本机模型。",
			deployNote: "部署层配置(知识目录、库文件路径、Ollama 地址与模型、维度)在 cordis.yml 的 config 中,修改后需重启。",
			"ops.title": "状态与手动同步",
			"ops.status": "对 agent 说「查一下知识库状态」(kb_status)",
			"ops.sync": "对 agent 说「我更新了文档,重新导一下」(kb_ingest)",
			readonly: "当前浏览器为远程连接,设置只读(settings 仅回环可写)。"
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
			"hint.chunk": "Heading-first split; oversized sections fall back to fixed windows with overlap.",
			"hint.search": "Hits returned per kb_search call; overridable per call.",
			"hint.batch": "Texts per Ollama request; too large may overload a local model.",
			deployNote: "Deployment settings (knowledge dir, db path, Ollama URL/model, dim) live in cordis.yml config and need a restart.",
			"ops.title": "Status & manual sync",
			"ops.status": "Ask the agent: \"check the knowledge base status\" (kb_status)",
			"ops.sync": "Ask the agent: \"I updated the docs, re-ingest\" (kb_ingest)",
			readonly: "Remote browser: settings are read-only (settings writes are loopback-only)."
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
			const host = ctx.settingsScope.bind({ namespace: "aomerag" });
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "aomerag",
				order: 30,
				label: () => t("nav"),
				inject: () => ({
					t,
					host
				})
			}, AomeragSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map