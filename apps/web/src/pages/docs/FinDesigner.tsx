// SPDX-License-Identifier: GPL-3.0-or-later
import {
  FCS_SINGLE_TAB,
  FUTURES_TAB_HOLES,
  FIN_BASE_LABEL,
  FIN_MAX_CANT,
  FIN_MAX_FRONT_OVERHANG,
  FIN_MIN_THICKNESS,
  FUTURES_TABS,
  rearClearance,
} from '@openshaper/kernel';
import { Link } from 'react-router-dom';
import { shortcutKeys } from '../../shortcuts';
import { DocsPage, Section, Term, Terms } from './DocsPage';

/** Kernel cm to a "12.7 mm" string. Numbers come from the kernel so the page can't drift. */
const mm = (cm: number) => `${Number((cm * 10).toFixed(2))} mm`;
const deg = (d: number) => `${Number(d.toFixed(1))}°`;

export default function DocsFinDesigner() {
  const side = FUTURES_TABS.side;
  const centre = FUTURES_TABS.centre;
  return (
    <DocsPage
      route="/docs/fin-designer"
      title="Fin designer"
      lede="Design a Futures-tab surf fin from scratch — outline, foil and flex — and export it for a CNC mill or a 3D printer."
      toc={[
        { id: 'start', label: 'Starting a fin' },
        { id: 'outline', label: 'The outline' },
        { id: 'foil', label: 'The foil' },
        { id: 'slices', label: 'Foil slices' },
        { id: 'taper', label: 'Thickness and flex' },
        { id: 'base', label: 'The base' },
        { id: 'tab', label: 'Placing the fin on its tab' },
        { id: 'rules', label: 'The rules it keeps' },
        { id: 'files', label: 'Saving your work' },
        { id: 'export', label: 'Exporting for CNC and printing' },
      ]}
    >
      <Section id="start" title="Starting a fin">
        <p>
          Open the <Link to="/fin">fin designer</Link> and choose a starting fin from{' '}
          <strong>New fin</strong>. The starting fins are a place to begin, not a catalogue: reshape
          them as far as you like. Each one sits on a standard Futures tab, which you don&apos;t
          edit — every Futures box takes the same tab.
        </p>
        <Terms>
          <Term name="Side, left or right">
            The {mm(side.height)}-deep side tab, with cant. Left and right are mirror images: the
            outside face points to the rail. They are named the way fin makers mark them, with the
            board seen from below, nose up — so a left fin goes on the rider&apos;s right rail.
          </Term>
          <Term name="Quad rear, left or right">
            The shallower {mm(centre.height)} tab (quad rears sit where the tail is thinner), with
            cant.
          </Term>
          <Term name="Centre">The {mm(centre.height)} tab, upright, with a symmetric foil.</Term>
          <Term name="Canard, left or right">
            A small fin on the FCS single tab (see <a href="#base">The base</a>), its base centred
            over the tab, with a flat inside face and no cant: the plug carries it.
          </Term>
        </Terms>
        <p>
          Both tabs are {mm(side.length)} long and {mm(side.thickness)} thick. Lengths are shown in
          millimetres.
        </p>
        <p>
          The fin is shown four ways: the profile, the foil section, the thickness and a 3D view.
          One fills the large pane on the left and the other three sit in small panes on the right;
          the swap button on a small pane brings its view into the large pane. The large pane&apos;s
          toolbar holds that view&apos;s controls. The 3D view keeps its controls (side, cant and
          position) under it when it is small. The measurements run along the bottom.
        </p>
      </Section>

      <Section id="outline" title="The outline">
        <p>
          The profile shows the fin from the side, drawn over its tab. Drag a point or a handle to
          reshape it; double-click the curve to add a point; select a point and press Delete to
          remove it. The toolbar&apos;s point tools do the same for the selected point on any curve
          — <strong>+</strong> adds a point halfway to the next, <strong>−</strong> deletes it — and
          make it <strong>Smooth</strong> (its handles in line) or a <strong>Corner</strong> (each
          handle free). A curve&apos;s two end points stay put. Drag empty space to pan and scroll
          to zoom. The outline starts and ends on the base: its two ends slide along it.
        </p>
        <p>
          <strong>Depth</strong> stretches the outline to a new height over the same base. Readouts
          show the area (the profile above the tab), depth, base length and sweep — the angle from
          the leading-edge root to the tip, measured from upright.
        </p>
      </Section>

      <Section id="foil" title="The foil">
        <p>
          The foil section is a horizontal slice through the fin: the outside face above the chord
          line, the inside face below, drawn four times taller than true so a thin foil can be
          shaped by hand. Its size follows the outline and the taper; this pane sets only its shape.
        </p>
        <Terms>
          <Term name="Flat inside">The usual side-fin foil: the inside face is flat.</Term>
          <Term name="Symmetric">
            The same curve on both faces — always the case on a centre fin.
          </Term>
          <Term name="NACA presets">
            Pick a NACA 4-digit foil from the list (2412, 0010, …), or Other… to type any code, and
            Apply to replace both faces with that foil, six points each; they stay editable
            afterwards. The convex face goes outside. A centre fin takes only symmetric 00xx foils.
            The foil keeps its proportions above the minimum thickness, so a 2412 stays 2 : 12
            camber to thickness however thick the fin.
          </Term>
        </Terms>
      </Section>

      <Section id="slices" title="Foil slices">
        <p>
          One foil runs all the way up the blade unless you add slices. <strong>Add slice</strong>{' '}
          (in the profile&apos;s toolbar) puts a dashed line across the profile; drag it up or down
          to set its height — in the profile or the thickness view. Each slice has its own foil:
          pick its tab in the foil view (Root, then each slice by height) and shape it with the same
          tools, NACA presets included. A new slice starts as a copy of the foil below it.
        </p>
        <p>
          Between slices the foil blends smoothly from one to the next, easing into each so no line
          forms at a slice; above the top slice it stays as that slice. The thickness still comes
          from the thickness curve. <strong>Remove slice</strong> takes the selected slice away.
          Slices keep at least 2% of the depth from each other and from the root and tip.
        </p>
      </Section>

      <Section id="taper" title="Thickness and flex">
        <p>
          The thickness view shows how thick the fin is at the foil&apos;s thickest point, from the
          root (bottom) to the tip (top). It stands upright at the fin&apos;s true depth, so it
          lines up with the profile; thickness runs across, drawn four times wider than true. A
          straight run that curves in near the tip is the usual shape: that curve is what controls
          how the tip flexes. <strong>Root thickness</strong> scales the whole curve.
        </p>
      </Section>

      <Section id="base" title="The base">
        <p>
          The base is the tab the fin sits on. Choose it with <strong>Base</strong>, beside the 3D
          view. Each starting fin begins on its usual Futures tab; changing the base re-places the
          fin on the new tab.
        </p>
        <Terms>
          <Term name={FIN_BASE_LABEL['futures-side']}>
            The {mm(side.height)}-deep Futures side tab, with cant built into the fin. Like the
            1/2&quot; tab it has four weight-saving holes through it, {mm(FUTURES_TAB_HOLES.length)}{' '}
            × {mm(FUTURES_TAB_HOLES.height)} with round ends, centred on its height.
          </Term>
          <Term name={FIN_BASE_LABEL['futures-centre']}>
            The {mm(centre.height)}-deep Futures centre tab, for centre and quad-rear fins. Its
            weight-saving holes sit level with the rear slot.
          </Term>
          <Term name={FIN_BASE_LABEL['fcs-single']}>
            A plain {mm(FCS_SINGLE_TAB.length)} × {mm(FCS_SINGLE_TAB.height)} ×{' '}
            {mm(FCS_SINGLE_TAB.thickness)} block for an FCS 1 style single plug, usual for small
            canard fins. It drops straight in and a grub screw in the side of the plug holds it, so
            it has no slot, notch, front-overhang limit or rear clearance. The plug sets the cant
            (0°, 5° or 9°), so the fin has none: the cant field is greyed out. A fin moved onto it
            starts centred over the tab, and the tab must stay wholly under the fin&apos;s base.
          </Term>
        </Terms>
      </Section>

      <Section id="tab" title="Placing the fin on its tab">
        <p>
          Starting fins are rear-aligned: the blade&apos;s trailing edge meets the tab&apos;s rear
          end. A flat inside face sits flush with the tab; a symmetric foil is centred on it.
        </p>
        <Terms>
          <Term name={`${shortcutKeys('fin-nudge-back')} ${shortcutKeys('fin-nudge-forward')}`}>
            Move the fin back or forward along the tab.
          </Term>
          <Term name={`${shortcutKeys('fin-nudge-out')} ${shortcutKeys('fin-nudge-in')}`}>
            Slide the blade across the tab — for a strongly curved inside face that overhangs the
            tab, slide it back over.
          </Term>
          <Term name={`Cant (0–${FIN_MAX_CANT}°)`}>
            How far the blade leans out from the tab. Futures builds cant into the fin, not the box.
            A centre fin has none.
          </Term>
        </Terms>
      </Section>

      <Section id="rules" title="The rules it keeps">
        <p>
          The designer won&apos;t let a drag break these; a point stops where it would. Anything
          that does break one (an old file, say) is listed under the readouts.
        </p>
        <Terms>
          <Term name="Front overhang">
            The leading edge may overhang the front of the tab by at most{' '}
            {mm(FIN_MAX_FRONT_OVERHANG)}: the box&apos;s grub screw sits there.
          </Term>
          <Term name="Raised rear">
            A Futures fin is fitted rear first, hooked on the pin at the back of the box, then
            rocked down — about {deg(rearClearance('side').tilt)} on a side tab,{' '}
            {deg(rearClearance('centre').tilt)} on a centre tab. Anything behind the tab swings
            toward the board, so a fin whose base runs past the tab&apos;s rear end needs a raised
            rear. The dashed orange line behind the tab is the clearance it needs. The raised rear
            keeps the base&apos;s foil: its underside is as thick as the foil is there, thinning to
            the minimum where it turns up into the trailing edge.
          </Term>
          <Term name="Minimum thickness">
            Nowhere thinner than {mm(FIN_MIN_THICKNESS)} — edges and tip included — so the fin is
            safe to bump into and something a cutter can make. The foil is shaped to the thickness
            curve less this, and this is added all the way along, so the faces stay curved right to
            edges that end at {mm(FIN_MIN_THICKNESS)}. A sharp bend in the outline — a hooked tip,
            say — reshapes the blade only near that edge, rather than creasing it right across.
          </Term>
          <Term name="One clean shape">
            The edges keep rising to a single tip, and the foil&apos;s faces never cross.
          </Term>
        </Terms>
      </Section>

      <Section id="files" title="Saving your work">
        <p>
          The fin saves itself in your browser as you work, so a reload or a closed tab doesn&apos;t
          lose it. <strong>Save</strong> ({shortcutKeys('save')}) downloads it as a{' '}
          <code>.fin.json</code> file to keep or share; <strong>Open…</strong> loads one back. Like
          the rest of OpenShaper, the designer works offline.
        </p>
      </Section>

      <Section id="export" title="Exporting for CNC and printing">
        <Terms>
          <Term name="STEP">
            For CNC. True curved surfaces, in millimetres: the blade and the tab as two solids that
            meet on the tab top. In Fusion 360 or similar, Combine / Join them into one body before
            machining. Within 0.05 mm of the design, except the last millimetre or two under the
            tip. The surface stays smooth across corners in the outline: only the edge has the
            corner.
          </Term>
          <Term name="STL">
            For 3D printing. A fine triangle mesh in millimetres, the unit slicers assume.
          </Term>
        </Terms>
        <p>Export is unavailable while the fin breaks a rule; the readouts say which.</p>
      </Section>
    </DocsPage>
  );
}
