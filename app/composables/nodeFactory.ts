import { markRaw } from 'vue'
import { defineNode, NodeInterface, type Editor } from '@baklavajs/core'
import { BaklavaInterfaceTypes, NodeInterfaceType, setType } from '@baklavajs/interface-types'
import {
  CheckboxInterface,
  NumberInterface,
  SelectInterface,
  SliderInterface,
  TextareaInputInterface,
  TextInputInterface,
  type IBaklavaViewModel,
} from '@baklavajs/renderer-vue'
import { isPortCompatible, type PortType } from '@anygen/core/ports'
import type { AssetRef, NodeMeta, ParamDef } from '@anygen/core'
import AssetPicker from '~/components/interfaces/AssetPicker.vue'
import { encodeParam, paramKey } from '~/utils/graphConvert'

// Baklava types interfaces as NodeInterface<any>; per-value variance would reject our subclasses.
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Factory = () => NodeInterface<any>

/** File-picker param: uploads to `/api/assets` and holds the resulting `AssetRef`. */
class AssetInterface extends NodeInterface<AssetRef | null> {
  constructor(
    name: string,
    value: AssetRef | null,
    public accept: string,
  ) {
    super(name, value)
    this.setComponent(markRaw(AssetPicker))
  }
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function paramInterface(p: ParamDef): NodeInterface<any> {
  const label = p.label ?? p.name
  const value = encodeParam(p, undefined)
  switch (p.type) {
    case 'textarea':
    case 'json':
      return new TextareaInputInterface(label, value as string).setPort(false)
    case 'number':
      return new NumberInterface(label, value as number, p.min, p.max).setPort(false)
    case 'slider':
      return new SliderInterface(label, value as number, p.min ?? 0, p.max ?? 1).setPort(false)
    case 'asset':
      return new AssetInterface(label, value as AssetRef | null, p.accept ?? '*/*').setPort(false)
    case 'boolean':
      return new CheckboxInterface(label, value as boolean).setPort(false)
    case 'select': {
      const items = (p.options ?? []).map((o) =>
        typeof o === 'string'
          ? { text: o, value: o }
          : { text: o.label ?? o.value, value: o.value },
      )
      return new SelectInterface(label, value as string, items).setPort(false)
    }
    default:
      return new TextInputInterface(label, value as string).setPort(false)
  }
}

/**
 * Registers one Baklava node type per catalog entry, plus the port type system (`any` connects to
 * everything, `list<T>` to `list<U>` when T fits U; mirrors `isPortCompatible` on the server).
 */
export function installCatalog(
  editor: Editor,
  viewModel: IBaklavaViewModel,
  catalog: readonly NodeMeta[],
) {
  const names = new Set<string>(['any'])
  for (const meta of catalog) {
    for (const port of [...meta.inputs, ...meta.outputs]) names.add(port.type)
  }
  const types = new Map([...names].map((n) => [n, new NodeInterfaceType<unknown>(n)]))
  for (const [from, fromType] of types) {
    for (const [to, toType] of types) {
      if (from !== to && isPortCompatible(from as PortType, to as PortType)) {
        fromType.addConversion(toType)
      }
    }
  }
  new BaklavaInterfaceTypes(editor, { viewPlugin: viewModel }).addTypes(...types.values())

  const port =
    (name: string, type: string): Factory =>
    () => {
      const intf = new NodeInterface<unknown>(name, undefined).setPort(true)
      setType(intf, types.get(type)!)
      return intf
    }

  for (const meta of catalog) {
    const inputs: Record<string, Factory> = {}
    for (const p of meta.inputs) inputs[p.name] = port(p.label ?? p.name, p.type)
    for (const p of meta.params) inputs[paramKey(p.name)] = () => paramInterface(p)
    const outputs: Record<string, Factory> = {}
    for (const p of meta.outputs) outputs[p.name] = port(p.label ?? p.name, p.type)

    const node = defineNode<Record<string, unknown>, Record<string, unknown>>({
      type: meta.id,
      title: meta.title,
      inputs,
      outputs,
    })
    editor.registerNodeType(node, { category: meta.category, title: meta.title })
  }
}
