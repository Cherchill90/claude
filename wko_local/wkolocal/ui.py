"""Design-System der Oberfläche: Farben (validierte Palette, hell/dunkel), Diagrammstil, Karten, Hinweisblöcke.

Regeln: feste Farbreihenfolge je Entität (nie nach Rang), keine Doppel-Y-Achsen (stattdessen gestapelte Teilplots),
Statusfarben nur für Zustände (immer mit Icon), Texte in Textfarben.
"""
from __future__ import annotations

import html

import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

# ---------------------------------------------------------------- Palette
CAT = {"light": ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
       "dark": ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"]}
TEXT2 = {"light": "#52514e", "dark": "#c3c2b7"}
NEUTRAL_FILL = {"light": "rgba(82,81,78,0.10)", "dark": "rgba(195,194,183,0.12)"}
BLUE_RAMP = ["#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab"]   # ordinal 250→550
STATUS = {"good": "#0ca30c", "warn": "#fab219", "bad": "#d03b3b", "info": None}
ICON = {"good": "✅", "info": "ℹ️", "warn": "⚠️", "bad": "🛑"}
SPORT_SLOT = {"Cycling": 0, "Running": 1}
SPORT_LABEL = {"Cycling": "Rad", "Running": "Lauf"}


def mode() -> str:
    try:
        return "dark" if (st.context.theme.type or "light") == "dark" else "light"
    except Exception:
        return "light"


def c(slot: int) -> str:
    """Kategoriale Farbe Slot 1..8 für den aktiven Modus."""
    return CAT[mode()][slot - 1]


def text2() -> str:
    return TEXT2[mode()]


def sport_color(sport: str) -> str:
    return c(SPORT_SLOT.get(sport, 2) + 1)


def sport_label(sport: str) -> str:
    return SPORT_LABEL.get(sport, sport)


# ---------------------------------------------------------------- CSS
CSS = """
<style>
/* Layout */
.block-container {padding-top: 2.2rem; padding-bottom: 3rem; max-width: 1480px;}
h1, h2, h3 {letter-spacing: -0.02em;}
[data-testid="stSidebarNav"] a span {font-weight: 500;}
/* Karten / Container mit Rahmen */
[data-testid="stVerticalBlockBorderWrapper"]:has(> div > [data-testid="stVerticalBlock"]) {transition: box-shadow .2s ease;}
[data-testid="stMetric"] {padding: .75rem .9rem; border-radius: .9rem;}
[data-testid="stMetricLabel"] p {font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; opacity: .75;}
[data-testid="stMetricValue"] {font-weight: 700; letter-spacing: -0.02em;}
/* Tabs moderner */
.stTabs [data-baseweb="tab-list"] {gap: .25rem;}
.stTabs [data-baseweb="tab"] {padding: .4rem .9rem; border-radius: .6rem;}
/* Expander dezenter */
[data-testid="stExpander"] details {border-radius: .8rem;}
/* Hinweisblöcke */
.wk-ins {border-radius: .9rem; padding: .85rem 1rem; margin: .25rem 0 .75rem 0;
         background: color-mix(in srgb, currentColor 3.5%, transparent); border: 1px solid color-mix(in srgb, currentColor 9%, transparent);}
.wk-ins .wk-head {display:flex; gap:.6rem; align-items:flex-start; font-weight:600; line-height:1.4;}
.wk-ins .wk-head .wk-bar {width:4px; align-self:stretch; border-radius:4px; flex:0 0 4px;}
.wk-ins ul {margin:.55rem 0 0 0; padding-left: 0; list-style:none;}
.wk-ins li {margin:.3rem 0; line-height:1.45; font-size:.93rem; opacity:.92;}
.wk-ins .wk-foot {margin-top:.5rem; font-size:.75rem; opacity:.6;}
/* Hero (Empfehlung) */
.wk-hero {border-radius: 1.1rem; padding: 1.2rem 1.3rem; position: relative; overflow: hidden;
          background: linear-gradient(135deg, color-mix(in srgb, var(--wk-accent) 16%, transparent), color-mix(in srgb, var(--wk-accent) 4%, transparent));
          border: 1px solid color-mix(in srgb, var(--wk-accent) 30%, transparent);}
.wk-hero .wk-kicker {font-size:.75rem; text-transform:uppercase; letter-spacing:.08em; opacity:.75; font-weight:600;}
.wk-hero .wk-title {font-size:1.9rem; font-weight:750; letter-spacing:-0.03em; margin:.15rem 0 .5rem 0; line-height:1.15;}
.wk-hero .wk-chips {display:flex; flex-wrap:wrap; gap:.4rem; margin-bottom:.7rem;}
.wk-chip {display:inline-flex; align-items:center; gap:.3rem; padding:.22rem .65rem; border-radius:999px; font-size:.82rem; font-weight:600;
          background: color-mix(in srgb, currentColor 8%, transparent); border: 1px solid color-mix(in srgb, currentColor 12%, transparent);}
.wk-hero ul {margin:.2rem 0 0 1.1rem; padding:0;}
.wk-hero li {margin:.28rem 0; line-height:1.45;}
.wk-sub {opacity:.7; margin-top:-.6rem; margin-bottom:1rem;}
/* Kompakte Kennzahlenleiste (umbrechend) */
.wk-stats {display:grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap:.6rem; margin:.25rem 0 1rem 0;}
.wk-stat {border-radius:.9rem; padding:.7rem .85rem; border:1px solid color-mix(in srgb, currentColor 11%, transparent);
          background: color-mix(in srgb, currentColor 2.5%, transparent);}
.wk-stat .l {font-size:.72rem; text-transform:uppercase; letter-spacing:.05em; opacity:.68; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.wk-stat .v {font-size:1.45rem; font-weight:700; letter-spacing:-0.02em; margin-top:.1rem; white-space:nowrap;}
.wk-stat .s {font-size:.78rem; opacity:.7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
[data-testid="stMetricValue"] {font-size: 1.75rem;}
/* Streamlit-Ballast ausblenden */
#MainMenu {visibility: hidden;} footer {visibility: hidden;} [data-testid="stDecoration"] {display:none;}
</style>
"""


def apply_theme() -> None:
    st.markdown(CSS, unsafe_allow_html=True)


# ---------------------------------------------------------------- HTML-Bausteine
def esc(s) -> str:
    return html.escape(str(s))


def page_header(title: str, subtitle: str | None = None) -> None:
    st.title(title)
    if subtitle:
        st.markdown(f"<div class='wk-sub'>{esc(subtitle)}</div>", unsafe_allow_html=True)


def insight_block(items: list, foot: str | None = None) -> None:
    """Kernaussage + Details als ruhiger Block. Statusfarbe nur als Balken, immer mit Icon (nie Farbe allein)."""
    if not items:
        return
    head, rest = items[0], items[1:]
    bar = STATUS.get(head.level) or text2()
    li = "".join(f"<li>{ICON[i.level]}&nbsp; {esc(i.text)}</li>" for i in rest)
    foot_html = f"<div class='wk-foot'>{esc(foot)}</div>" if foot else ""
    st.markdown(f"<div class='wk-ins'><div class='wk-head'><span class='wk-bar' style='background:{bar}'></span>"
                f"<span>{ICON[head.level]}&nbsp; {esc(head.text)}</span></div>{'<ul>' + li + '</ul>' if li else ''}{foot_html}</div>",
                unsafe_allow_html=True)


def hero(kicker: str, title: str, chips: list[str], bullets: list[str], level: str = "good", accent: str | None = None) -> None:
    accent = accent or (c(1) if level == "good" else STATUS.get(level) or c(1))
    ch = "".join(f"<span class='wk-chip'>{esc(x)}</span>" for x in chips)
    ul = "".join(f"<li>{esc(b)}</li>" for b in bullets)
    st.markdown(f"<div class='wk-hero' style='--wk-accent:{accent}'><div class='wk-kicker'>{esc(kicker)}</div>"
                f"<div class='wk-title'>{esc(title)}</div><div class='wk-chips'>{ch}</div>{'<ul>' + ul + '</ul>' if ul else ''}</div>",
                unsafe_allow_html=True)


def stats(items: list[tuple]) -> None:
    """Kennzahlenleiste: (Label, Wert[, Zusatz]) – bricht auf schmalen Fenstern automatisch um."""
    cells = "".join(f"<div class='wk-stat'><div class='l'>{esc(i[0])}</div><div class='v'>{esc(i[1])}</div>"
                    + (f"<div class='s'>{esc(i[2])}</div>" if len(i) > 2 and i[2] else "") + "</div>" for i in items)
    st.markdown(f"<div class='wk-stats'>{cells}</div>", unsafe_allow_html=True)


# ---------------------------------------------------------------- Diagramme
PLOT_CONFIG = {"displayModeBar": False, "displaylogo": False, "scrollZoom": False, "doubleClick": "reset"}


def style(fig: go.Figure, height: int = 380, legend: bool = True, hover: str = "x unified", title: str | None = None) -> go.Figure:
    fig.update_layout(
        height=height, hovermode=hover,
        title=dict(text=title, x=0, xanchor="left", y=0.985, yref="container", yanchor="top", font=dict(size=15)) if title else None,
        margin=dict(l=8, r=8, t=(70 if legend else 44) if title else (34 if legend else 12), b=8), bargap=0.25,
        legend=dict(orientation="h", yanchor="bottom", y=1.01, xanchor="left", x=0, font=dict(size=12)) if legend else None,
        showlegend=legend, hoverlabel=dict(font_size=12), transition_duration=250)
    fig.update_xaxes(showgrid=False, zeroline=False, showspikes=True, spikemode="across", spikethickness=1,
                     spikedash="dot", spikecolor=text2())
    fig.update_yaxes(gridcolor=NEUTRAL_FILL[mode()], zeroline=False)
    return fig


def chart(fig: go.Figure, key: str | None = None, on_select=None, **kw):
    if on_select:
        return st.plotly_chart(fig, width="stretch", theme="streamlit", config=PLOT_CONFIG, key=key,
                               on_select=on_select, selection_mode=kw.get("selection_mode", ("points",)))
    return st.plotly_chart(fig, width="stretch", theme="streamlit", config=PLOT_CONFIG, key=key)


def stacked(rows: int, heights: list[float], titles: list[str] | None = None) -> go.Figure:
    """Mehrere Messgrößen untereinander mit gemeinsamer Zeitachse (statt Doppelachse)."""
    return make_subplots(rows=rows, cols=1, shared_xaxes=True, vertical_spacing=0.045, row_heights=heights,
                         subplot_titles=titles)


def range_buttons(fig: go.Figure) -> None:
    """Zeitraum-Schnellwahl über der (ersten) Zeitachse."""
    fig.update_layout(xaxis_rangeselector=dict(
        buttons=[dict(count=1, label="1M", step="month", stepmode="backward"),
                 dict(count=3, label="3M", step="month", stepmode="backward"),
                 dict(count=6, label="6M", step="month", stepmode="backward"),
                 dict(count=1, label="1J", step="year", stepmode="backward"),
                 dict(step="all", label="Alle")],
        x=0, y=1.02, yanchor="bottom", font=dict(size=11), bgcolor=NEUTRAL_FILL[mode()], activecolor=c(1)))
    # Legende unter das Diagramm, damit sie nicht mit der Schnellwahl kollidiert
    fig.update_layout(legend=dict(orientation="h", y=-0.08, yanchor="top", x=0, xanchor="left"), margin=dict(t=44, b=40))
