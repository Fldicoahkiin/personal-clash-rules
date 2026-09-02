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
const allFormats = [...completeConfigFormats, ...nodeOnlyFormats];

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
  const selectedFormat = allFormats.find((format) => format.target === target)
    ?? completeConfigFormats[0];
  const selectedMode = completeConfigFormats.some((format) => format.target === target)
    ? "完整配置"
    : "仅节点";

  return (
    <details className="subscription-format-picker">
      <summary>
        <span>输出客户端</span>
        <span className="subscription-format-current">
          {selectedFormat.icon ? (
            <img src={selectedFormat.icon} alt="" width="24" height="24" />
          ) : null}
          <strong>{selectedFormat.name}</strong>
          <small>{selectedMode}</small>
        </span>
      </summary>
      <div className="subscription-format-picker-body">
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
      </div>
    </details>
  );
}
