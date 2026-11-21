import SplitText from '../components/kit/SplitText'

export default function NotFound() {
  return (
    <article className="pf-section">
      <div className="pf-container pf-narrow pf-notfound">
        <SplitText
          tag="h1"
          text="Page not found"
          className="pf-page-title"
          splitType="words"
          delay={60}
          trigger="load"
          textAlign="center"
        />
        <p className="pf-lede" style={{ textAlign: 'center' }}>
          That route does not exist in this sample portfolio.
        </p>
        <p style={{ textAlign: 'center' }}>
          <a className="pf-btn pf-btn-primary" href="#/">Back home</a>
        </p>
      </div>
    </article>
  )
}
