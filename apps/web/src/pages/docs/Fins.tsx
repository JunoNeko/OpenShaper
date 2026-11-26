// SPDX-License-Identifier: GPL-3.0-or-later
import { FIN_PROFILE_LABELS, FIN_SETUP_LABELS, FIN_SYSTEM_LABELS } from '@openshaper/kernel';
import { DocsPage, Section, Term, Terms } from './DocsPage';

/**
 * Setups, systems and profiles are listed from the kernel's own label records, so
 * this page cannot list a setup the app doesn't have (or miss one it does). The
 * prose below still has to be written by hand — see docs/coverage.test.ts.
 */
export default function DocsFins() {
  return (
    <DocsPage
      route="/docs/fins"
      title="Fins"
      lede="Setups, mounting systems and the fins themselves — and why fin placement follows the board rather than sitting at fixed coordinates."
      toc={[
        { id: 'choosing', label: 'Choosing fins' },
        { id: 'own', label: 'Your own fins' },
        { id: 'parametric', label: 'How placement works' },
        { id: 'setups', label: 'Setups' },
        { id: 'systems', label: 'Systems' },
        { id: 'profiles', label: 'Profiles' },
        { id: 'boxes', label: 'Boxes and clearance' },
        { id: 'exports', label: 'Fins in exports' },
      ]}
    >
      <Section id="choosing" title="Choosing fins">
        <p>
          Pick a <strong>setup</strong> and a <strong>system</strong> under <strong>Fins</strong> in
          the Build tab. The board gets the setup&apos;s usual fins at medium size. Then{' '}
          <strong>Choose fins</strong>:
        </p>
        <Terms>
          <Term name="A set">
            Every fin at once: Thruster, Quad, Five-fin, Twin, Keel, 2+1 or Single, in{' '}
            <strong>S</strong>, <strong>M</strong> or <strong>L</strong>.
          </Term>
          <Term name="One fin">
            Select a fin (P1, S2, …) and <strong>Change</strong> it alone, to mix and match. With{' '}
            <strong>Symmetrical</strong> on, its mirror partner changes with it.
          </Term>
        </Terms>
        <p>
          Every fin is an OpenFinShaper design, set on the tab your system takes, so the 3D view and
          the exports show its real foil and outline. Its shape and its cant are the fin&apos;s own;
          the board places it: distance from the tail, inset from the rail and toe-in. On FCS the
          plugs carry the cant: choose <strong>5°</strong> or <strong>9°</strong> for the front (or
          side) plugs and a quad&apos;s rear plugs; a centre plug is upright. A single fin, and a
          2+1&apos;s centre, sit in a US box whatever the system.
        </p>
        <p>
          Boards saved before fin designs keep their plain generic fins until you choose new ones.
        </p>
      </Section>

      <Section id="own" title="Your own fins">
        <p>
          Select a fin and <strong>Change</strong> it. Under <strong>My fins</strong>:
        </p>
        <Terms>
          <Term name="My fins">
            Your imported fins, kept in this browser for any board. <strong>Use</strong> puts one on
            the selected fin (and its mirror partner while Symmetrical is on); ✕ removes it from the
            list.
          </Term>
          <Term name="Import .fin.json">
            Adds OpenFinShaper fin files to My fins. You can design custom fins in OpenFinShaper and
            export them as <code>.fin.json</code> to import here.
          </Term>
        </Terms>
        <p>
          A fin is set on the tab your board&apos;s system takes, so one designed on another tab
          moves onto this board&apos;s. A board keeps its fins in its file, so it opens with them
          anywhere, My fins or not.
        </p>
      </Section>

      <Section id="parametric" title="How placement works">
        <p>
          Every fin is placed by its <strong>fin dot</strong>: the bottom of its trailing edge, the
          mark a shaper makes. Its distance from the tail and its inset from the rail are both
          measured to the dot, and toe-in turns the fin about it. On a fin with a raised rear (a
          keel&apos;s, running back clear of the board) the dot is under the bottom of its trailing
          edge, behind the box. Drag the dot on the outline to move a fin.
        </p>
        <p>
          The box follows the fin: its slot starts the fin&apos;s own distance ahead of the dot,
          from the trailing edge to the back of its tab. So choosing a bigger fin, or a keel, moves
          the box, not the dot. The outline view draws the dot, the tab&apos;s slot and the box.
        </p>
        <p>
          A fin is not pinned to fixed coordinates. Its lateral position is an inset from the rail,
          and its base rides the bottom rocker surface — so when you change the outline or the
          profile, the fins move with the board, exactly as a shaper marks a blank relative to the
          rail and the tail.
        </p>
        <p>
          What is saved is the intent — the setup, the system, the specs — and the actual geometry
          is computed against the current shape whenever it is needed.
        </p>
      </Section>

      <Section id="setups" title="Setups">
        <p>How many fins, and where they sit.</p>
        <Terms>
          {Object.entries(FIN_SETUP_LABELS).map(([id, label]) => (
            <Term key={id} name={label}>
              {SETUP_NOTES[id] ?? 'Fin arrangement.'}
            </Term>
          ))}
        </Terms>
      </Section>

      <Section id="systems" title="Systems">
        <p>
          The mounting system determines the box or plug geometry routed into the board, which is
          what appears in the exports.
        </p>
        <Terms>
          {Object.entries(FIN_SYSTEM_LABELS).map(([id, label]) => (
            <Term key={id} name={label}>
              {SYSTEM_NOTES[id] ?? 'Mounting system.'}
            </Term>
          ))}
        </Terms>
      </Section>

      <Section id="profiles" title="Profiles">
        <p>
          The plain blade outlines of boards saved before fin designs. Choosing fins replaces them.
        </p>
        <Terms>
          {Object.entries(FIN_PROFILE_LABELS).map(([id, label]) => (
            <Term key={id} name={label}>
              {PROFILE_NOTES[id] ?? 'Blade template.'}
            </Term>
          ))}
        </Terms>
      </Section>

      <Section id="boxes" title="Boxes and clearance">
        <p>
          The 3D view&apos;s <strong>Boxes</strong> button draws each fin&apos;s box or plug on the
          bottom (Futures and FCS II), so you can see how close a flange comes to the rail. The Fins
          panel warns when a box comes within 10 mm of the rail, sits across a channel&apos;s wall,
          or is too deep for the board above it: under 3 mm of foam left, which a thin tail toward
          the rail can come to.
        </p>
      </Section>

      <Section id="exports" title="Fins in exports">
        <p>
          Fin positions and box footprints carry through to the STL, the DXF and the 1:1 PDF, so the
          routing positions come out with the rest of the board rather than being marked separately.
        </p>
      </Section>
    </DocsPage>
  );
}

const SETUP_NOTES: Record<string, string> = {
  none: 'No fins — the default, and what every geometry calculation assumes unless you add them.',
  single: 'One centre fin. Longboards and classic single-fin shapes.',
  twin: 'Two side fins, no centre. Loose and fast through the flats.',
  thruster: 'Two side fins plus a centre fin. The default modern arrangement.',
  quad: 'Four fins, two per side, no centre.',
  '2+1': 'Two side fins plus a centre box — the longboard/mid-length convention.',
  '5-fin': 'Five boxes so the board can be ridden as a thruster or a quad.',
  twinzer:
    'Twin fins with a small canard ahead of each. The twins take the fin system you choose; the canards their own box, an FCS single plug by default, at 5° or 9° of cant (9° to start). A Futures canard box is listed as coming soon.',
};

const SYSTEM_NOTES: Record<string, string> = {
  'glass-on': 'Fins laminated directly to the board. No box, so nothing is routed.',
  'fcs-ii': 'A continuous routed slot per fin.',
  'fcs-x2': 'Two round plugs per fin, about 3″ centre to centre.',
  futures: 'One continuous box per fin, deeper on the sides than the centre.',
};

const PROFILE_NOTES: Record<string, string> = {
  thruster: 'Upright, moderate rake — the general-purpose modern template.',
  single: 'Larger, more raked centre-fin outline.',
  noserider: 'Deep, heavily raked longboard fin for holding a nose ride.',
  keel: 'Short, long-based swept fin for fish and twin setups.',
};
