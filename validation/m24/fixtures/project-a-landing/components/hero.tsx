import VantaBackground from '../components/kit/VantaBackground'
import SplitText from '../components/kit/SplitText'
import BlurText from '../components/kit/BlurText'

export default function Hero() {
  return (
    <section className="nb-hero" aria-label="Nebula introduction">
      {/* Vanta Birds — the engine-attached background component handles lazy
          init, destroy on unmount, WebGL and reduced-motion fallbacks. */}
      <VantaBackground
        effect="birds"
        colors={['#8b7cf7', '#3fd0ff']}
        background="#05060b"
        speed={0.9}
        className="nb-hero-bg"
      >
        <div className="nb-container nb-hero-inner">
          <p className="nb-eyebrow" data-animate>
            <BlurText text="Now in public preview" delay={40} animateBy="words" className="nb-eyebrow-text" trigger="load" />
          </p>
          <SplitText
            tag="h1"
            text="Infrastructure that thinks at the speed of your ideas"
            className="nb-hero-title"
            splitType="words"
            delay={120}
            duration={1}
            ease="power3.out"
            trigger="load"
          />
          <p className="nb-hero-sub" data-animate>
            Nebula is the AI infrastructure platform for teams that ship —
            managed inference, vector search and evaluation pipelines behind
            one API. (Sample marketing copy for a fictional product.)
          </p>
          <div className="nb-hero-actions" data-animate>
            <a className="nb-btn nb-btn-primary nb-btn-lg" href="#pricing">
              Start building
            </a>
            <a className="nb-btn nb-btn-ghost nb-btn-lg" href="#showcase">
              See it in action
            </a>
          </div>
          <p className="nb-hero-note" data-animate>
            Free tier included · No credit card required
          </p>
        </div>
      </VantaBackground>
    </section>
  )
}
