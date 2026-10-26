import { memo, useLayoutEffect, useRef } from 'react'
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
export const RollingValue = memo(function RollingValue({
  value
}: {
  value: string
}): React.ReactElement {
  const reduced = useReducedMotionPreference()
  const host = useRef<HTMLSpanElement>(null)
  const characters = getCharacters(value)
  const previous = useRef(new Map(characters.map(({ key, value }) => [key, value])))
  useLayoutEffect(() => {
    const animations: Animation[] = []
    // One effect per counter, rather than a presence tree and Motion effects
    // for every digit. Navigation can reconnect this cached label cheaply.
    if (!reduced) {
      for (const node of host.current?.querySelectorAll<HTMLElement>('[data-place]') ?? []) {
        const old = previous.current.get(node.dataset.place!)
        if (old === undefined || old === node.dataset.value) continue
        const current = node.querySelector<HTMLElement>('.rolling-value__label--current')
        const outgoing = node.querySelector<HTMLElement>('.rolling-value__label--previous')
        const timing = { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        if (current)
          animations.push(
            current.animate(
              [
                { transform: 'translateY(100%)', opacity: 0 },
                { transform: 'translateY(0)', opacity: 1 }
              ],
              timing
            )
          )
        if (outgoing)
          animations.push(
            outgoing.animate(
              [
                { transform: 'translateY(0)', opacity: 1 },
                { transform: 'translateY(-100%)', opacity: 0 }
              ],
              timing
            )
          )
      }
    }
    previous.current = new Map(getCharacters(value).map(({ key, value }) => [key, value]))
    return () => animations.forEach((animation) => animation.cancel())
  }, [value, reduced])
  return (
    <span ref={host} className="rolling-value">
      {reduced ? (
        value
      ) : (
        <>
          <span className="rolling-value__measure">{value}</span>
          <span className="rolling-value__characters" aria-hidden="true">
            {characters.map((character) => (
              <span
                key={character.key}
                className={`rolling-value__character${character.digit ? ' rolling-value__character--digit' : ''}`}
                data-place={character.key}
                data-value={character.value}
              >
                {character.digit && (
                  <>
                    <span
                      className="rolling-value__label rolling-value__label--current"
                      data-value={character.value}
                    />
                    {previous.current.has(character.key) &&
                      previous.current.get(character.key) !== character.value && (
                        <span
                          className="rolling-value__label rolling-value__label--previous"
                          data-value={previous.current.get(character.key)}
                        />
                      )}
                  </>
                )}
              </span>
            ))}
          </span>
        </>
      )}
    </span>
  )
})
