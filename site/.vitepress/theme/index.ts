import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import Landing from './components/Landing.vue'

import './tokens.css'
import './site.css'
import './landing.css'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('Landing', Landing)
  },
} satisfies Theme
