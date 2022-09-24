const bucket = new WeakMap()

let activeEffect
const effectStack = []

function effect (fn,options = {}){
  const effectFn = () =>{
    cleanup(effectFn)
    activeEffect = effectFn
    effectStack.push(effectFn)
    const res = fn()
    effectStack.pop(effectFn)
    activeEffect = effectStack[effectStack.length - 1]
    return res
  }
  effectFn.options = options
  effectFn.deps = []
  // 非 lazy 的時候才執行
  if(!options.lazy){
    effectFn()
  }
  return effectFn
}

// 刪除與之關聯的集合
function cleanup(effectFn) {
  for(let i = 0;i < effectFn.deps.length;i++){
    const deps = effectFn.deps[i]
    deps.delete(effectFn)
  }
  effectFn.deps.length = 0
}

const data = { ok :true, text: 'hello world', bar:1, foo: 2}

const obj = new Proxy(data,{
  get(target,key){
    track(target,key)
    return target[key]
  },
  set(target,key,newVal){
    target[key] = newVal
    trigger(target,key)
  }
})

// 函數追蹤變化
function track(target,key){
  if(!activeEffect) return 
  let depsMap = bucket.get(target)
  if(!depsMap) bucket.set(target, (depsMap = new Map()))
 
  let deps = depsMap.get(key)
  if(!deps) depsMap.set(key,(deps = new Set()))
  deps.add(activeEffect)
  // 與當前副作用函式存在聯繫的依賴集合
  activeEffect.deps.push(deps)
}

// 函數觸發變化
function trigger(target,key){
  const depsMap = bucket.get(target)
  if(!depsMap) return
  const effects = depsMap.get(key)
  // 創建一個新的Set，可參考 Set.prototype.forEach 會造成什麼問題
  const effectsToRun = new Set(effects)
  effects && effects.forEach(effectFn =>{
    // 如果 trigger 觸發執行的副作用函式與當前正在執行的副作用函式相同，則不進行觸發
    if(effectFn !== activeEffect){
      effectsToRun.add(effectFn)
    }
  })
  effectsToRun.forEach(effectFn => {
    // 如果存在調度器，則調用調度器，並將副作用函式作為參數傳遞
    if(effectFn.options.scheduler){
      effectFn.options.scheduler(effectFn)
    }else{
      effectFn()
    }
  })
}

// 計算屬性
function computed(getter){
  // 緩存上一次計算的值
  let value 
  // 標示是否需要重新計算值， 為 true 代表 需要計算
  let dirty = true

  const effectFn = effect(getter,{
    lazy:true,
    // 調度器中將 dirty 重置為 true ， 避免監聽的值修改了卻不會重新計算
    scheduler(){
      dirty = true
      // 當計算屬性依賴的響應式數據發生變化時，手動調用 trigger 觸發響應
      trigger(obj,'value')
    }
  })
  const obj = {
    // 當讀取 value 時才會執行 effectFn
    get value(){
      if(dirty){
        value = effectFn()
        dirty = false
      }
      // 當讀取 value 時，手動調用 track 進行追蹤
      track(obj,'value')
      return value
    }
  }

  return obj
}

// test 1
// effect(function effectFn () {
//   document.body.innerText = obj.ok ? obj.text : 'not'
// })
// setTimeout(()=>{
//   obj.ok = false
// },3000)
// setTimeout(() =>{
//   obj.text = 'hello vu3'
// },5000)

// test effect stack

// effect(() =>{
//   console.log('effect1')

//   effect(()=>{
//     console.log('effect2')
//     obj.foo
//   })
//   obj.bar 
// })

// obj.bar = 'test'

// test computed

const sumRes = computed(()=> obj.bar + obj.foo)
console.log(sumRes.value)