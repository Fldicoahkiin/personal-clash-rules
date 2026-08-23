import type { OutputTarget } from "../features/subscriptions/api";
import {
  completeConfigFormats,
  nodeResourceFormats,
  secondaryFormats,
  type ClientFormat,
} from "../features/subscriptions/client-formats";

type SubscriptionFormatPickerProps = {
  target: OutputTarget;
  onChange: (target: OutputTarget) => void;
};

const additionalFormats = [...nodeResourceFormats, ...secondaryFormats];

function FormatButton({
  active,
  format,
  onChange,
}: {
  active: boolean;
  format: ClientFormat;
  onChange: (target: OutputTarget) => void;
}) {
  return (
    <button
      className={active ? "is-active" : ""}
      type="button"
      onClick={() => onChange(format.target)}
      aria-pressed={active}
    >
      {format.icon ? (
        <img src={format.icon} alt="" width="24" height="24" />
      ) : null}
      <span>{format.name}</span>
    </button>
  );
}

export function SubscriptionFormatPicker({
  target,
  onChange,
}: SubscriptionFormatPickerProps) {
  return (
    <>
      <fieldset className="client-picker">
        <legend>选择客户端</legend>
        {completeConfigFormats.map((format) => (
          <FormatButton
            active={target === format.target}
            format={format}
            key={format.target}
            onChange={onChange}
          />
        ))}
      </fieldset>

      <details className="subscription-more-formats">
        <summary>其他输出格式</summary>
        <div className="client-picker">
          {additionalFormats.map((format) => (
            <FormatButton
              active={target === format.target}
              format={format}
              key={format.target}
              onChange={onChange}
            />
          ))}
        </div>
      </details>
    </>
  );
}
