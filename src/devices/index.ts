// pattern-check: skip — barrel: the device-controls vocabulary and its helpers.
export type * from './types'
export { bindingOf, defaultBinding } from './defaults'
export {
    defaultLayout,
    FORM_KIND,
    formatHidSummary,
    type HidCounts,
} from './defaultLayout'
export { fromPhysicalLayout } from './fromPhysicalLayout'
export {
    control,
    pickControls,
    SHELL_ZONES,
    STOCK_FLIGHTSTICK,
    STOCK_GAMEPAD,
    STOCK_MOUSE,
    type StockLayout,
} from './stockLayouts'
export { KeylessServiceBase } from './keylessService'
