import { AnimatePresence, motion } from 'motion/react'
import { useReducedMotionPreference } from '../motion/useReducedMotionPreference'
import './RollingValue.css'

type Character = { key: string; value: string; digit: boolean }

// Keep digit places stable when a number grows, and time groups stable when units appear.
const getCharacters = (value: string): Character[] => {
  const characters: Character[] = []
  const staticOccurrences = new Map<string, number>()
  let numberIndex = 0
  for (const match of value.matchAll(/(\d[\d,]*(?:\.\d+)?)([hms])?|(\D+)/g)) {
    const [, number, unit, text] = match
    if (number != null) {
      const group = unit ? `time:${unit}` : `number:${numberIndex++}`
      const [integer, fraction] = number.split('.')
      let place = integer.replace(/\D/g, '').length
      for (const character of integer) {
        const digit = /\d/.test(character)
        characters.push({
          key: `${group}:${digit ? `integer:${--place}` : `separator:${place}`}`,
          value: character,
          digit
        })
      }
      if (fraction != null) {
        characters.push({ key: `${group}:decimal`, value: '.', digit: false })
        Array.from(fraction).forEach((character, index) => {
          characters.push({ key: `${group}:fraction:${index}`, value: character, digit: true })
        })
      }
      if (unit) characters.push({ key: `${group}:unit`, value: unit, digit: false })
    } else {
      for (const character of text) {
        const occurrence = staticOccurrences.get(character) ?? 0
        staticOccurrences.set(character, occurrence + 1)
        characters.push({
          key: `static:${character}:${occurrence}`,
          value: character,
          digit: false
        })
      }
    }
  }
  return characters
}

/** Only changed digits roll upward; punctuation, units, and unchanged places stay still. */
export function RollingValue({ value }: { value: string }): React.ReactElement {
  const reduced = useReducedMotionPreference()
  return (
    <span className="rolling-value">
      {reduced ? (
        value
      ) : (
        <>
          <span className="rolling-value__measure">{value}</span>
          <span className="rolling-value__characters" aria-hidden="true">
            {getCharacters(value).map((character) => (
              <span
                key={character.key}
                className={`rolling-value__character${character.digit ? ' rolling-value__character--digit' : ''}`}
                data-place={character.key}
                data-value={character.value}
              >
                {character.digit && (
                  <AnimatePresence initial={false}>
                    <motion.span
                      key={character.value}
                      className="rolling-value__label"
                      data-value={character.value}
                      initial={{ y: '100%', opacity: 0 }}
                      animate={{ y: '0%', opacity: 1 }}
                      exit={{ y: '-100%', opacity: 0 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </AnimatePresence>
                )}
              </span>
            ))}
          </span>
        </>
      )}
    </span>
  )
}
