import { roundDurations, roundDurationText as text, type RoundDuration } from '../lib/roundDuration'

export function RoundDurationControl({ value, disabled, onChange }: {
  value: RoundDuration
  disabled?: boolean
  onChange: (value: RoundDuration) => void
}) {
  return (
    <fieldset className="palette-mode-fieldset" disabled={disabled}>
      <legend>{text.label}</legend>
      <div className="palette-mode-buttons">
        {roundDurations.map(duration => (
          <button
            type="button"
            key={duration}
            disabled={disabled}
            aria-pressed={value === duration}
            aria-label={`${duration} ${text.seconds}`}
            onClick={() => onChange(duration)}
          >
            {duration} s
          </button>
        ))}
      </div>
    </fieldset>
  )
}
