import { displayedPolicyGroups } from "../lib/policy-groups";

export function PolicyMap() {
  return (
    <section
      className="policy-section page-width"
      id="policies"
      aria-labelledby="policy-title"
    >
      <header className="plain-heading">
        <h2 id="policy-title">策略组</h2>
        <p>Mihomo 覆写</p>
      </header>

      <div className="policy-table-wrap">
        <table className="policy-table">
          <thead>
            <tr>
              <th>策略</th>
              <th>初始项</th>
              <th>可选节点组</th>
            </tr>
          </thead>
          <tbody>
            {displayedPolicyGroups.map((policy) => (
              <tr key={policy.name}>
                <th scope="row">{policy.name}</th>
                <td>
                  <code>{policy.initial}</code>
                </td>
                <td>
                  <div className="policy-route">
                    {policy.options.map((option) => (
                      <span
                        className={option === policy.initial ? "is-active" : ""}
                        key={option}
                      >
                        <i aria-hidden="true" />
                        {option}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="policy-note">
        节点名称分组：US · JP · SG · HK · TW · KR · EU
      </p>
    </section>
  );
}
