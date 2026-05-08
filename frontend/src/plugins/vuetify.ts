import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

/**
 * Vuetify theme — palette từ design tokens Smax (mockup chat-smax-v3.html).
 * `smax-light` (default) khớp mockup. `legacy-dark` giữ lại để fallback nếu
 * có view nào còn phụ thuộc bảng màu cũ; sẽ rút khi mọi view đã migrate.
 */
export const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: localStorage.getItem('theme') || 'smax-light',
    themes: {
      'smax-light': {
        dark: false,
        colors: {
          background: '#f5f6fa',
          surface: '#ffffff',
          'surface-variant': '#fafbfc',
          primary: '#2962ff',
          secondary: '#1f2330',
          accent: '#2962ff',
          error: '#ff3d00',
          warning: '#ff9100',
          success: '#00c853',
          info: '#2196f3',
          'on-background': '#212121',
          'on-surface': '#212121',
          'on-primary': '#ffffff',
          'on-secondary': '#ffffff',
        },
      },
      'legacy-dark': {
        dark: true,
        colors: {
          background: '#0A192F',
          surface: '#112240',
          'surface-variant': '#1D2D50',
          primary: '#00F2FF',
          secondary: '#E6F1FF',
          accent: '#00F2FF',
          error: '#FF5252',
          warning: '#FFB74D',
          success: '#4CAF50',
          info: '#00F2FF',
          'on-background': '#E6F1FF',
          'on-surface': '#E6F1FF',
          'on-primary': '#0A192F',
        },
      },
    },
  },
  defaults: {
    VBtn: { variant: 'flat' },
    VTextField: { variant: 'outlined', density: 'compact' },
    VSelect: { variant: 'outlined', density: 'compact' },
    VAutocomplete: { variant: 'outlined', density: 'compact' },
    VTextarea: { variant: 'outlined', density: 'compact' },
    VCard: { rounded: 'md', variant: 'flat' },
    VChip: { rounded: 'lg', size: 'small' },
    VDialog: { maxWidth: 600 },
  },
});
