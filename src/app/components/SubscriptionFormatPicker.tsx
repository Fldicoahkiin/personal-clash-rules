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

const nodeOnlyFormats = [...nodeResourceFormats, ...secondaryFormats];

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
      <fieldset className="client-picker subscription-format-group">
        <legend>
          <strong>完整配置</strong>
          <small>含策略组、规则和 DNS</small>
        </legend>
        {completeConfigFormats.map((format) => (
          <FormatButton
            active={target === format.target}
            format={format}
            key={format.target}
            onChange={onChange}
          />
        ))}
      </fieldset>

      <fieldset className="client-picker subscription-format-group">
        <legend>
          <strong>仅节点</strong>
          <small>不含策略组、规则和 DNS</small>
        </legend>
        {nodeOnlyFormats.map((format) => (
          <FormatButton
            active={target === format.target}
            format={format}
            key={format.target}
            onChange={onChange}
          />
        ))}
      </fieldset>
    </>
  );
}
