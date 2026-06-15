export default function Error({ statusCode }) {
    return (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', background:'hsl(224,71%,4%)', color:'hsl(213,31%,91%)' }}>
            <h1 style={{ fontSize:'2rem', fontWeight:'700' }}>{statusCode || 'Error'}</h1>
            <p style={{ color:'hsl(215,16%,57%)' }}>{statusCode === 404 ? 'Page not found' : 'An error occurred'}</p>
        </div>
    );
}

Error.getInitialProps = ({ res, err }) => ({
    statusCode: res?.statusCode ?? err?.statusCode ?? 404,
});
