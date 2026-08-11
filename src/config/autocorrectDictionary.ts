// Pattern check: no GoF pattern (-) — rejected — a frozen data table of typo /
// correction pairs behind one accessor; no variant family, no construction logic.
//
// A starter dictionary for on-device autocorrect (§5.2-E), so that turning the
// feature on does not begin with an empty table the user has to fill by hand.
// The app offers it as "load defaults"; nothing consumes it implicitly, because
// a dictionary the user did not ask for silently rewriting their typing is the
// worst possible first impression of the feature.
//
// ---- Why the list is conservative -------------------------------------------
//
// The matcher fires the moment the characters typed SO FAR end with a dictionary
// entry — it has no notion of where a word begins or ends (the history resets on
// space, punctuation, backspace and navigation, which is only a LEFT boundary).
// Two consequences shape every entry below:
//
//   - an entry that is a SUFFIX of a correctly-spelled word would corrupt that
//     word: "wich" → "which" would rewrite "sandwich", and "cant" → "can't"
//     would rewrite "decant". Neither is here, and neither should be added.
//   - an entry that is a PREFIX of a longer correct word fires early, mid-word:
//     "comming" → "coming" also fires inside "commingle". Entries are kept only
//     where the typo is overwhelmingly more likely than the word it shadows.
//
// Corrections may not contain spaces, because the device replays them through
// the same character alphabet it tracks — so "alot" → "a lot" is not expressible
// and is deliberately absent rather than approximated.
//
// Everything here is plain English orthography; nothing is copied from another
// project's dictionary.

import type { AutocorrectEntry } from './compilers/remappr/autocorrect'

/**
 * The starter dictionary, sorted by typo so a diff of an edited config stays
 * readable. Safe to hand straight to `encodeAutocorrectDictionary`.
 */
export const DEFAULT_AUTOCORRECT_ENTRIES: readonly AutocorrectEntry[] =
    Object.freeze([
        { typo: 'accomodate', correction: 'accommodate' },
        { typo: 'acheive', correction: 'achieve' },
        { typo: 'acheived', correction: 'achieved' },
        { typo: 'acommodate', correction: 'accommodate' },
        { typo: 'adress', correction: 'address' },
        { typo: 'agian', correction: 'again' },
        { typo: 'allmost', correction: 'almost' },
        { typo: 'allready', correction: 'already' },
        { typo: 'alwasy', correction: 'always' },
        { typo: 'amoung', correction: 'among' },
        { typo: 'apparant', correction: 'apparent' },
        { typo: 'arguement', correction: 'argument' },
        { typo: 'becasue', correction: 'because' },
        { typo: 'becuase', correction: 'because' },
        { typo: 'begining', correction: 'beginning' },
        { typo: 'beleif', correction: 'belief' },
        { typo: 'beleive', correction: 'believe' },
        { typo: 'beleived', correction: 'believed' },
        { typo: 'betweeen', correction: 'between' },
        { typo: 'calender', correction: 'calendar' },
        { typo: 'catagory', correction: 'category' },
        { typo: 'cieling', correction: 'ceiling' },
        { typo: 'collegue', correction: 'colleague' },
        { typo: 'commited', correction: 'committed' },
        { typo: 'commitee', correction: 'committee' },
        { typo: 'completly', correction: 'completely' },
        { typo: 'concious', correction: 'conscious' },
        { typo: 'curiousity', correction: 'curiosity' },
        { typo: 'decieve', correction: 'deceive' },
        { typo: 'definately', correction: 'definitely' },
        { typo: 'dissapear', correction: 'disappear' },
        { typo: 'dissapoint', correction: 'disappoint' },
        { typo: 'embarass', correction: 'embarrass' },
        { typo: 'enviroment', correction: 'environment' },
        { typo: 'equiptment', correction: 'equipment' },
        { typo: 'excercise', correction: 'exercise' },
        { typo: 'existance', correction: 'existence' },
        { typo: 'experiance', correction: 'experience' },
        { typo: 'familar', correction: 'familiar' },
        { typo: 'foriegn', correction: 'foreign' },
        { typo: 'forword', correction: 'forward' },
        { typo: 'fourty', correction: 'forty' },
        { typo: 'foward', correction: 'forward' },
        { typo: 'freind', correction: 'friend' },
        { typo: 'garantee', correction: 'guarantee' },
        { typo: 'goverment', correction: 'government' },
        { typo: 'gratefull', correction: 'grateful' },
        { typo: 'happend', correction: 'happened' },
        { typo: 'harrass', correction: 'harass' },
        { typo: 'heigth', correction: 'height' },
        { typo: 'immediatly', correction: 'immediately' },
        { typo: 'independant', correction: 'independent' },
        { typo: 'interupt', correction: 'interrupt' },
        { typo: 'knowlege', correction: 'knowledge' },
        { typo: 'liason', correction: 'liaison' },
        { typo: 'libary', correction: 'library' },
        { typo: 'lisence', correction: 'license' },
        { typo: 'maintainance', correction: 'maintenance' },
        { typo: 'managment', correction: 'management' },
        { typo: 'millenium', correction: 'millennium' },
        { typo: 'mispell', correction: 'misspell' },
        { typo: 'neccessary', correction: 'necessary' },
        { typo: 'noticable', correction: 'noticeable' },
        { typo: 'occassion', correction: 'occasion' },
        { typo: 'occured', correction: 'occurred' },
        { typo: 'occurence', correction: 'occurrence' },
        { typo: 'ocurred', correction: 'occurred' },
        { typo: 'oppurtunity', correction: 'opportunity' },
        { typo: 'paralel', correction: 'parallel' },
        { typo: 'particulary', correction: 'particularly' },
        { typo: 'peice', correction: 'piece' },
        { typo: 'personel', correction: 'personnel' },
        { typo: 'posession', correction: 'possession' },
        { typo: 'prefered', correction: 'preferred' },
        { typo: 'priviledge', correction: 'privilege' },
        { typo: 'probablly', correction: 'probably' },
        { typo: 'pronounciation', correction: 'pronunciation' },
        { typo: 'publically', correction: 'publicly' },
        { typo: 'questionaire', correction: 'questionnaire' },
        { typo: 'reccomend', correction: 'recommend' },
        { typo: 'recieve', correction: 'receive' },
        { typo: 'recieved', correction: 'received' },
        { typo: 'refered', correction: 'referred' },
        { typo: 'relevent', correction: 'relevant' },
        { typo: 'religous', correction: 'religious' },
        { typo: 'remeber', correction: 'remember' },
        { typo: 'resturant', correction: 'restaurant' },
        { typo: 'rythm', correction: 'rhythm' },
        { typo: 'saftey', correction: 'safety' },
        { typo: 'seperate', correction: 'separate' },
        { typo: 'seperated', correction: 'separated' },
        { typo: 'seperately', correction: 'separately' },
        { typo: 'similiar', correction: 'similar' },
        { typo: 'sincerly', correction: 'sincerely' },
        { typo: 'speach', correction: 'speech' },
        { typo: 'strenght', correction: 'strength' },
        { typo: 'succesful', correction: 'successful' },
        { typo: 'successfull', correction: 'successful' },
        { typo: 'surprize', correction: 'surprise' },
        { typo: 'taht', correction: 'that' },
        { typo: 'teh', correction: 'the' },
        { typo: 'tendancy', correction: 'tendency' },
        { typo: 'themselfs', correction: 'themselves' },
        { typo: 'thier', correction: 'their' },
        { typo: 'thsi', correction: 'this' },
        { typo: 'tomarrow', correction: 'tomorrow' },
        { typo: 'tommorrow', correction: 'tomorrow' },
        { typo: 'truely', correction: 'truly' },
        { typo: 'untill', correction: 'until' },
        { typo: 'usefull', correction: 'useful' },
        { typo: 'usualy', correction: 'usually' },
        { typo: 'vaccum', correction: 'vacuum' },
        { typo: 'vegatable', correction: 'vegetable' },
        { typo: 'visable', correction: 'visible' },
        { typo: 'wierd', correction: 'weird' },
        { typo: 'writting', correction: 'writing' },
        { typo: 'wrok', correction: 'work' },
        { typo: 'yeild', correction: 'yield' },
        { typo: 'youre', correction: "you're" },
    ] as const)

/** A mutable copy, for callers that hand the list to an editor. */
export function defaultAutocorrectEntries(): AutocorrectEntry[] {
    return DEFAULT_AUTOCORRECT_ENTRIES.map((e) => ({ ...e }))
}
