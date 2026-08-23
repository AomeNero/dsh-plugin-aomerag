// 浏览器半 bundle 构建(dsh client 插件产物格式):
// CJS 闭包工厂,window.__ModuleLoader__.load 挂载;平台模块经注入的 require(模块表)解析。
// external 清单与 dsh 仓库 packages/client/web/src/platform.ts 的 PLATFORM_MODULES 保持一致。
// 我们不使用 CSS Modules,故未搬官方预设的 lightningcss 插件。

import { defineConfig } from 'tsdown'

/** 浏览器平台模块表(来源:dsh web/src/platform.ts;升级 dsh 时需同步) */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

export default defineConfig({
  name: 'dsh-plugin-aomerag/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...PLATFORM_MODULES],
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.MODE': '"production"',
    'import.meta.env': '{"MODE":"production"}',
  },
  // 平台模块保持 external,其余(本插件代码/locales)全部内联
  noExternal: (id: string) => (PLATFORM_MODULES.includes(id as never) ? undefined : true),
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-plugin-aomerag", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
