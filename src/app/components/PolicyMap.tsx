const serviceGroups = [
  "AI",
  "STEAM",
  "STEAM-DOWNLOAD",
  "STEAM-ONLINE",
  "BILIBILI",
  "ANIGAMER",
  "DISCORD",
  "DEV",
  "MEDIA",
  "SOCIAL",
];
const regionGroups = ["US", "JP", "SG", "HK", "TW", "KR", "EU"];

export function PolicyMap() {
  return (
    <section
      className="policy-section page-width"
      id="policies"
      aria-labelledby="policy-title"
    >
      <div className="section-heading">
        <div>
          <p className="section-kicker">03 · POLICY MAP</p>
          <h2 id="policy-title">服务分流与地区选择</h2>
        </div>
        <p>
          服务先进入独立策略组，再手动选择地区节点。地区匹配依赖节点名称，不读取或推测节点出口 IP。
        </p>
      </div>

      <div className="policy-map" role="img" aria-label="规则到服务策略再到地区节点的流向">
        <div className="map-column">
          <span className="map-label">RULE SETS</span>
          <div className="map-primary">17 个规则集</div>
          <p>域名、进程与私有网段</p>
        </div>
        <span className="map-connector" aria-hidden="true" />
        <div className="map-column">
          <span className="map-label">POLICIES</span>
          <div className="chip-grid">
            {serviceGroups.map((group) => (
              <span key={group}>{group}</span>
            ))}
          </div>
        </div>
        <span className="map-connector" aria-hidden="true" />
        <div className="map-column">
          <span className="map-label">REGIONS</span>
          <div className="chip-grid region-grid">
            {regionGroups.map((group) => (
              <span key={group}>{group}</span>
            ))}
          </div>
        </div>
      </div>
      <p className="map-note">
        建议节点名包含国家代码或城市，例如 US Los Angeles 01、JP Tokyo 01、SG Singapore 01。
      </p>
    </section>
  );
}
