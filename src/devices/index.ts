// pattern-check: skip — barrel: the device-controls vocabulary and its helpers.
export type * from './types'
export { bindingOf, defaultBinding } from './defaults'
export {
    defaultLayout,
    FORM_KIND,
    formatHidSummary,
    splitGamepadAxes,
    type HidCounts,
} from './defaultLayout'
export { fromPhysicalLayout } from './fromPhysicalLayout'
export {
    control,
    NEW_CONTROL,
    pickControls,
    SHELL_ZONES,
    STOCK_FLIGHTSTICK,
    STOCK_GAMEPAD,
    STOCK_MOUSE,
    type StockLayout,
} from './stockLayouts'
export { KeylessServiceBase } from './keylessService'
export { clearLayout, loadLayout, saveLayout } from './layoutCache'
export { createLayoutOverride, type LayoutOverride } from './layoutOverride'
export {
    CONTROL_KINDS,
    CONTROL_SHAPES,
    DEVICE_FORMS,
    DeviceLayoutSchema,
    deviceLayoutJsonSchema,
    layoutFits,
    layoutFromModel,
    modelFromLayout,
    parseDeviceLayout,
    type DeviceLayoutDoc,
    type LayoutParse,
} from './schema'
export {
    addVariant,
    inVariant,
    removeVariant,
    renameVariant,
    variantControls,
} from './variants'
