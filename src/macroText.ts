// Pattern check: no GoF pattern (-) — rejected — two pure functions over the
// MacroAction list; a phrase table per kind is a plain dispatch map.
//
// Plain-language views of a macro for the editor, firmware-neutral: the "What it
// does" sentence and the "every held key is let go" check. Key names come from
// the caller, which knows how its keycodes are labelled.
import type { MacroAction } from './types'

const COUNT_WORD = ['', 'once', 'twice', 'three times']

function times(n: number): string {
    return COUNT_WORD[n] ?? `${n} times`
}

type KeyName = (code: number) => string
type Phrase<A extends MacroAction> = (a: A, keyName: KeyName, repeat: number) => string

const PHRASE: { [K in MacroAction['kind']]: Phrase<Extract<MacroAction, { kind: K }>> } = {
    tap: (a, k, n) => (n > 1 ? `taps ${k(a.keycode)} ${times(n)}` : `taps ${k(a.keycode)}`),
    down: (a, k) => `holds ${k(a.keycode)}`,
    up: (a, k) => `lets go of ${k(a.keycode)}`,
    delay: (a) => `waits ${a.ms} ms`,
    text: (a) => `types “${a.text}”`,
    pause: () => 'waits until you let go of the key',
    call: (a) => `runs ${a.macro}`,
    locked: (a) => a.phrase,
}

/** One sentence saying what the macro does: "Holds Ctrl, taps C, waits 40 ms,
 *  then lets go of Ctrl." Repeated taps of one key fold into "taps X three
 *  times". An empty macro "does nothing yet." */
export function describeMacro(
    actions: readonly MacroAction[],
    keyName: KeyName,
): string {
    const parts: string[] = []
    for (let i = 0; i < actions.length; ) {
        const a = actions[i]
        let n = 1
        while (a.kind === 'tap' && sameTap(actions[i + n], a.keycode)) n++
        parts.push((PHRASE[a.kind] as Phrase<MacroAction>)(a, keyName, n))
        i += n
    }
    if (parts.length === 0) return 'Does nothing yet.'
    const text =
        parts.length > 1
            ? [...parts.slice(0, -1), `then ${parts[parts.length - 1]}`].join(', ')
            : parts[0]
    return `${text[0].toUpperCase()}${text.slice(1)}.`
}

function sameTap(a: MacroAction | undefined, keycode: number): boolean {
    return a?.kind === 'tap' && a.keycode === keycode
}

/** Keys a Hold step presses that no later Let go step releases, in the order
 *  they were held (each once). Empty = every held key is let go by the end.
 *  A Hold with no key chosen yet (keycode 0) holds nothing. */
export function heldAtEnd(actions: readonly MacroAction[]): number[] {
    const held: number[] = []
    for (const a of actions) {
        if (a.kind === 'down' && a.keycode && !held.includes(a.keycode)) held.push(a.keycode)
        if (a.kind === 'up') {
            const i = held.indexOf(a.keycode)
            if (i >= 0) held.splice(i, 1)
        }
    }
    return held
}
