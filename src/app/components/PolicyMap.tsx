const policies = [
  {
    name: "AI",
    initial: "GLOBAL",
    options: ["GLOBAL", "US", "JP", "SG", "TW"],
  },
  {
    name: "STEAM",
    initial: "DIRECT",
    options: ["DIRECT", "GLOBAL", "JP", "US", "SG"],
  },
  {
    name: "STEAM-DOWNLOAD",
    initial: "DIRECT",
    options: ["DIRECT", "GLOBAL", "JP", "US", "SG", "HK", "TW"],
  },
  {
    name: "STEAM-ONLINE",
    initial: "DIRECT",
    options: ["DIRECT", "GLOBAL", "JP", "US", "SG", "HK", "TW"],
  },
  {
    name: "BILIBILI",
    initial: "DIRECT",
    options: ["DIRECT", "GLOBAL", "HK", "TW", "SG"],
  },
  {
    name: "ANIGAMER",
    initial: "TW",
    options: ["TW", "GLOBAL", "DIRECT", "AUTO"],
  },
  {
    name: "DISCORD",
    initial: "GLOBAL",
    options: ["GLOBAL", "US", "JP", "SG", "DIRECT"],
  },
];

export function PolicyMap() {
  return (
    <section
      className="policy-section page-width"
      id="policies"
      aria-labelledby="policy-title"
    >
      <header className="plain-heading">
        <h2 id="policy-title">策略组</h2>
        <p>默认与出口</p>
      </header>

      <div className="policy-table-wrap">
        <table className="policy-table">
          <thead>
            <tr>
              <th>策略</th>
              <th>默认</th>
              <th>可选出口</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => (
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
      <p className="policy-note">地区节点：US · JP · SG · HK · TW · KR · EU</p>
    </section>
  );
}
