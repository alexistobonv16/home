import FadeIn from './FadeIn'

const services = [
  {
    num: '01',
    name: 'Desarrollo Web',
    desc: 'Creación de sitios web modernos, rápidos y responsivos con atención al detalle en diseño, rendimiento y experiencia de usuario.',
  },
  {
    num: '02',
    name: 'Aplicaciones Full Stack',
    desc: 'Desarrollo de aplicaciones web completas, desde el frontend con React hasta el backend y despliegue en la nube con Cloudflare y Vercel.',
  },
  {
    num: '03',
    name: 'Plataformas de Contenido',
    desc: 'Creación y gestión de portales digitales de noticias y divulgación, optimizados para SEO y con entrega rápida de contenido.',
  },
  {
    num: '04',
    name: 'PWA & Apps Móviles',
    desc: 'Desarrollo de aplicaciones web progresivas con funcionamiento offline, instalables en cualquier dispositivo y con experiencia nativa.',
  },
  {
    num: '05',
    name: 'Diseño UI/UX',
    desc: 'Diseño de interfaces limpias, modernas y centradas en la conversión, con atención a la tipografía, el layout y la experiencia del usuario.',
  },
]

export default function ServicesSection() {
  return (
    <section id="servicios" className="bg-white rounded-t-[40px] sm:rounded-t-[50px] md:rounded-t-[60px] px-5 sm:px-8 md:px-10 py-20 sm:py-24 md:py-32">
      <FadeIn delay={0} y={40}>
        <h2
          className="text-[#0C0C0C] font-black uppercase text-center mb-16 sm:mb-20 md:mb-28"
          style={{ fontSize: 'clamp(3rem, 12vw, 160px)' }}
        >
          Servicios
        </h2>
      </FadeIn>

      <div className="max-w-5xl mx-auto">
        {services.map((service, i) => (
          <FadeIn key={service.num} delay={i * 0.1} y={30}>
            <div
              className="flex items-start gap-6 sm:gap-8 md:gap-12 py-8 sm:py-10 md:py-12"
              style={{
                borderBottom:
                  i < services.length - 1
                    ? '1px solid rgba(12, 12, 12, 0.15)'
                    : 'none',
              }}
            >
              <span
                className="text-[#0C0C0C] font-black leading-none flex-shrink-0"
                style={{ fontSize: 'clamp(3rem, 10vw, 140px)' }}
              >
                {service.num}
              </span>
              <div className="flex flex-col gap-2 pt-2 sm:pt-4 md:pt-6">
                <h3
                  className="text-[#0C0C0C] font-medium uppercase"
                  style={{ fontSize: 'clamp(1rem, 2.2vw, 2.1rem)' }}
                >
                  {service.name}
                </h3>
                <p
                  className="text-[#0C0C0C] font-light leading-relaxed max-w-2xl opacity-60"
                  style={{ fontSize: 'clamp(0.85rem, 1.6vw, 1.25rem)' }}
                >
                  {service.desc}
                </p>
              </div>
            </div>
          </FadeIn>
        ))}
      </div>
    </section>
  )
}
