import type { Locale } from './protocol.ts'

// Danish nouns are all common gender (en), so the adjectives agree without inflection.
const WORDS: Record<Locale, { adjectives: string[]; animals: string[] }> = {
  da: {
    adjectives: ['modig', 'kvik', 'glad', 'rolig', 'snedig', 'venlig', 'munter', 'frisk', 'flink', 'stolt', 'vild', 'lun', 'nysgerrig', 'listig', 'hurtig', 'blid'],
    animals: ['odder', 'ræv', 'ugle', 'sæl', 'elg', 'los', 'hare', 'grævling', 'mår', 'egern', 'pindsvin', 'ravn', 'stork', 'hjort', 'skildpadde', 'panda'],
  },
  en: {
    adjectives: ['marvelous', 'brave', 'clever', 'calm', 'cheerful', 'curious', 'friendly', 'gentle', 'jolly', 'lively', 'nimble', 'proud', 'quick', 'sly', 'wild', 'witty'],
    animals: ['otter', 'fox', 'owl', 'seal', 'moose', 'lynx', 'hare', 'badger', 'marten', 'squirrel', 'hedgehog', 'raven', 'stork', 'deer', 'turtle', 'panda'],
  },
}

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]!

/** A random `adjective-animal` name, such as `marvelous-otter`. Names may repeat; pids identify. */
export function randomName(locale: Locale): string {
  const { adjectives, animals } = WORDS[locale]
  return `${pick(adjectives)}-${pick(animals)}`
}
