  <div style="padding: 6px 20px 0; display: flex; justify-content: space-between; align-items: center">
    <span style="font-size: 18px; font-weight: 700">November</span>
    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); background: var(--card); border: 1px solid var(--card-bd); border-radius: 10px; padding: 3px">
      <a href="Week.dc.html" style="padding: 7px 14px; border-radius: 7px; color: var(--muted); font-size: 13px; text-decoration: none; text-align: center">Week</a>
      <a href="Month.dc.html" style="padding: 7px 14px; border-radius: 7px; background: var(--accent-soft); color: var(--accent-soft-ink); font-size: 13px; font-weight: 600; text-decoration: none; text-align: center">Month</a>
    </div>
  </div>
  <p style="margin: 8px 20px 0; font-size: 14px; color: var(--text2); line-height: 1.45">Three a week, every week so far. That's the habit. Keep it.</p>

  <div style="margin: 16px 12px 0; background: var(--card); border: 1px solid var(--card-bd); border-radius: 16px; padding: 12px 10px; box-shadow: var(--card-sh)">
    <div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)) 40px; gap: 4px; font-size: 11px; color: var(--muted); text-align: center; padding-bottom: 6px">
      <span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span><span>hrs</span>
    </div>
    <div style="display: flex; flex-direction: column; gap: 4px">
      <sc-for list="{{weeks}}" as="wk" hint-placeholder-count="6">
        <div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)) 40px; gap: 4px">
          <sc-for list="{{wk.days}}" as="d" hint-placeholder-count="7">
            <div style="{{d.cell}}">
              <span style="{{d.num}}">{{d.n}}</span>
              <sc-if value="{{d.done}}" hint-placeholder-val="{{false}}">
                <div style="display: flex; flex-direction: column; gap: 1px; width: 100%; height: {{d.h}}">
                  <div style="flex: 1; background: var(--z4); border-radius: 2px 2px 0 0"></div>
                  <div style="flex: 1; background: var(--z3)"></div>
                  <div style="flex: 5; background: var(--z2); border-radius: 0 0 2px 2px"></div>
                </div>
              </sc-if>
              <sc-if value="{{d.planned}}" hint-placeholder-val="{{false}}">
                <div style="width: 100%; height: {{d.h}}; box-sizing: border-box; border: 1px dashed var(--plan); border-radius: 3px"></div>
              </sc-if>
            </div>
          </sc-for>
          <span style="{{wk.totStyle}}">{{wk.tot}}</span>
        </div>
      </sc-for>
    </div>
  </div>

  <div style="margin: 16px 20px 0; display: flex; flex-wrap: wrap; gap: 14px; font-size: 11px; color: var(--muted)">
    <span style="display: flex; align-items: center; gap: 6px"><span style="width: 8px; height: 8px; border-radius: 50%; background: var(--z2)"></span>Z2</span>
    <span style="display: flex; align-items: center; gap: 6px"><span style="width: 8px; height: 8px; border-radius: 50%; background: var(--z3)"></span>Z3</span>
    <span style="display: flex; align-items: center; gap: 6px"><span style="width: 8px; height: 8px; border-radius: 50%; background: var(--z4)"></span>Z4</span>
    <span style="display: flex; align-items: center; gap: 6px"><span style="width: 8px; height: 8px; border-radius: 50%; background: var(--z5)"></span>Z5+</span>
    <span style="display: flex; align-items: center; gap: 6px"><span style="width: 10px; height: 8px; border: 1px dashed var(--plan); border-radius: 2px"></span>planned</span>
  </div>

  <div style="flex-grow: 1"></div>
<!--NAV-->
