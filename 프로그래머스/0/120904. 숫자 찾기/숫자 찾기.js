function solution(num, k) {
    const str = num.toString();
    const idx = str.indexOf(k.toString());
    
    return idx === -1 ? -1 : idx + 1;
}