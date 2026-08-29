// @vitest-environment jsdom
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))

vi.mock('@/api', () => ({ api }))

import AiConfigDialog from './ai-config-dialog.vue'

const passthrough = defineComponent({
  setup(_, { slots }) {
    return () => h('div', slots.default?.())
  },
})

const selectStub = defineComponent({
  name: 'VSelect',
  props: ['modelValue', 'items', 'label'],
  emits: ['update:modelValue'],
  template: '<div data-testid="provider-select" />',
})

const textFieldStub = defineComponent({
  name: 'VTextField',
  props: ['modelValue', 'label'],
  emits: ['update:modelValue'],
  template: '<div />',
})

const comboboxStub = defineComponent({
  name: 'VCombobox',
  props: ['modelValue', 'items', 'label', 'hint'],
  emits: ['update:modelValue'],
  template: '<div><slot name="append" /></div>',
})

describe('AiConfigDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.get.mockImplementation(async (url: string) => {
      if (url === '/ai/providers') {
        return {
          data: [
            { id: '9router', name: '9Router', baseUrl: 'http://host.docker.internal:20128/v1', hasKey: true, keyMask: '••••1234' },
            { id: 'f5quota', name: 'F5Quota', baseUrl: 'https://f5quota.store/v1', hasKey: false, keyMask: '' },
          ],
        }
      }
      return { data: { models: [], error: 'Chưa cấu hình API key' } }
    })
  })

  it('switches to F5Quota defaults and clears a model from the previous provider', async () => {
    const wrapper = shallowMount(AiConfigDialog, {
      props: {
        modelValue: false,
        loading: false,
        config: { provider: '9router', model: 'cx/gpt-5.5', maxDaily: 500, enabled: true },
      },
      global: {
        stubs: {
          VDialog: passthrough,
          VCard: passthrough,
          VCardTitle: passthrough,
          VCardText: passthrough,
          VProgressLinear: passthrough,
          VSelect: selectStub,
          VTextField: textFieldStub,
          VIcon: passthrough,
          VCombobox: comboboxStub,
          VSwitch: passthrough,
          VCardActions: passthrough,
          VSpacer: passthrough,
          VBtn: passthrough,
        },
      },
    })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    ;(wrapper.vm as unknown as { onProviderChange: (providerId: string) => void })
      .onProviderChange('f5quota')
    await flushPromises()

    const baseUrl = wrapper.findAllComponents(textFieldStub)
      .find((field) => field.props('label') === 'Base URL')
    expect(baseUrl?.props('modelValue')).toBe('https://f5quota.store/v1')
    expect(wrapper.getComponent(comboboxStub).props('modelValue')).toBe('')
    expect(wrapper.text()).toContain('F5Quota hỗ trợ các model Claude và Codex')
    expect(api.get).toHaveBeenCalledWith('/ai/providers/f5quota/models')
  })
})
